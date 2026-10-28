// Cached reads (migration 0018 + revcache.js): a cached answer is never served after a change.
// Run against a local `wrangler dev` with migration 0018 applied:
//   API_BASE=http://127.0.0.1:8890 node --test --test-concurrency=1 worker/test/read-budget.test.mjs
// The test duty it adds is removed at the end; the hospital order it changes is put back.
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const OWNER = process.env.LOCAL_OWNER || 'adm_mv7kjvs4';

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}
const signIn = async u => (await call('POST', '/api/accounts/login', { body: { username: u, key: await deriveKey(u, 'Pass-1234'), deviceId: 'deviceReadBudget-' + u + 'xxxxxxxx', deviceLabel: 'Test' } })).data.token;

async function loadAll(token, path = '/api/db') {
  let after = 0, rows = [], page, first;
  do {
    page = (await call('GET', `${path}?after=${after}`, { token })).data;
    first = first || page;
    rows = rows.concat(page.rows);
    after = page.last;
  } while (page.more);
  return { rows, rev: first.rev, time: first.time };
}
const find = (rows, c, id) => rows.find(r => r[0] === c && r[1] === id);
const n = rev => Number(String(rev).split('.')[1]);

let tok, hosp;
const DUTY = 'zz_readbudget_' + Date.now();

test('signed out: still refused', async () => {
  assert.equal((await call('GET', '/api/db')).status, 401);
  assert.equal((await call('GET', '/api/db?since=1&rev=1')).status, 401);
  assert.equal((await call('GET', '/api/er')).status, 401);
});

test('a page answers the same from the cache, with the change counter', async () => {
  tok = await signIn(OWNER);
  assert.ok(tok);
  const a = (await call('GET', '/api/db?after=0', { token: tok })).data;
  const b = (await call('GET', '/api/db?after=0', { token: tok })).data;
  assert.match(String(a.rev), /^\d+\.\d+$/, 'rev ' + a.rev);
  assert.equal(b.rev, a.rev);
  assert.deepEqual(b.rows, a.rows);
  assert.equal(b.last, a.last);
  assert.equal(b.more, a.more);
  assert.equal(a.full, true);
  assert.equal(a.role, 'owner');
  assert.ok(b.time >= a.time);
  hosp = a.rows.find(r => r[0] === 'hospital')[1];
});

test('a new duty shows at once in the full load and in the changes', async () => {
  const before = await loadAll(tok);
  const nothing = (await call('GET', `/api/db?since=${before.time - 1000}&rev=${before.rev}`, { token: tok })).data;
  assert.deepEqual([nothing.changed, nothing.deleted], [[], []], 'unchanged counter: nothing new');
  assert.equal(nothing.rev, before.rev);

  const id = `${hosp}:${DUTY}`;
  const put = await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'sched', id, h: hosp, o: 0, bv: 0, d: { date: '1/1/2020', name: 'zz test', specCode: 'ZZ' } }] } });
  assert.equal(put.status, 200);
  assert.equal(put.data.applied.length, 1, JSON.stringify(put.data));

  const after = await loadAll(tok);
  assert.ok(n(after.rev) > n(before.rev), `counter raised ${before.rev} -> ${after.rev}`);
  assert.ok(find(after.rows, 'sched', id), 'the full load has the new duty');
  assert.equal(after.rows.length, before.rows.length + 1);

  const changes = (await call('GET', `/api/db?since=${before.time - 1000}&rev=${before.rev}`, { token: tok })).data;
  assert.ok(changes.changed.some(r => r[0] === 'sched' && r[1] === id), 'the changes have the new duty');
  const none = (await call('GET', `/api/db?since=${after.time - 1000}&rev=${after.rev}`, { token: tok })).data;
  assert.deepEqual(none.changed, []);

  // Deleted: gone from the full load, listed in the changes.
  const v = put.data.applied[0][1];
  const del = await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'sched', id, bv: v, del: 1 }] } });
  assert.equal(del.data.applied.length, 1, JSON.stringify(del.data));
  const gone = await loadAll(tok);
  assert.ok(n(gone.rev) > n(after.rev));
  assert.ok(!find(gone.rows, 'sched', id), 'deleted from the full load');
  const changes2 = (await call('GET', `/api/db?since=${after.time - 1000}&rev=${after.rev}`, { token: tok })).data;
  assert.ok(changes2.deleted.some(([c, i]) => c === 'sched' && i === id), 'the changes list the deletion');
});

test('a new order shows at once; an unchanged order writes nothing', async () => {
  const before = await loadAll(tok);
  const h = find(before.rows, 'hospital', hosp);
  const o = h[3];
  const same = await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'hospital', id: hosp, o, ordOnly: 1 }] } });
  assert.equal(same.status, 200);
  assert.equal((await loadAll(tok)).rev, before.rev, 'the same order: no change');
  try {
    await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'hospital', id: hosp, o: o + 0.5, ordOnly: 1 }] } });
    const moved = await loadAll(tok);
    assert.ok(n(moved.rev) > n(before.rev));
    assert.equal(find(moved.rows, 'hospital', hosp)[3], o + 0.5);
  } finally {
    await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'hospital', id: hosp, o, ordOnly: 1 }] } });
  }
  assert.equal(find((await loadAll(tok)).rows, 'hospital', hosp)[3], o, 'put back');
});

test('the public hospital list follows a change of order', async () => {
  const list = async () => (await call('GET', '/api/public/hospitals')).data.hospitals.map(h => h.id);
  const before = await list();
  const all = await loadAll(tok);
  const last = all.rows.filter(r => r[0] === 'hospital').sort((a, b) => a[3] - b[3] || (a[1] < b[1] ? -1 : 1));
  const first = last[0], end = last[last.length - 1];
  try {
    await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'hospital', id: first[1], o: end[3] + 1, ordOnly: 1 }] } });
    const after = await list();
    assert.equal(after[after.length - 1], first[1], 'moved to the end at once');
  } finally {
    await call('POST', '/api/sync', { token: tok, body: { msg: 'read budget test', ops: [{ c: 'hospital', id: first[1], o: first[3], ordOnly: 1 }] } });
  }
  assert.deepEqual(await list(), before);
});
