// End-to-end tests against a running Worker (default: `wrangler dev` on 127.0.0.1:8787)
// seeded with worker/.local/import.sql. They modify data, so re-import afterwards.
// Run: API_BASE=http://127.0.0.1:8787 node --test worker/test/api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HubSync = require(path.join(root, 'hub-sync.js'));
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
// A private data snapshot (never committed): worker/.local/test-hub-data.json, or HUB_DATA=<path>.
const DATA_FILE = process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json');
const SOURCE = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const PW = SOURCE.globalPasswords;

async function call(method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function loadAll(token, endpoint = '/api/db') {
  let after = 0, rows = [], page;
  do {
    page = (await call('GET', `${endpoint}?after=${after}`, { token })).data;
    rows = rows.concat(page.rows);
    after = page.last;
  } while (page.more);
  return rows;
}

const login = async (password, extra = {}) => (await call('POST', '/api/login', { body: { password, ...extra } })).data;
const tokens = {};

test('health', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('wrong password is refused', async () => {
  const r = await login('definitely-wrong');
  assert.equal(r.success, false);
});

test('each role logs in with its existing password', async () => {
  for (const role of ['owner', 'admin', 'anaesthesia', 'user']) {
    const r = await login(PW[role]);
    assert.equal(r.success, true, role);
    assert.equal(r.role, role);
    assert.ok(r.token);
    tokens[role] = r.token;
  }
  const hid = Object.keys(SOURCE.hospitals).find(h => SOURCE.hospitals[h].passwords?.admin && SOURCE.hospitals[h].passwords.admin !== PW.admin);
  const r = await login(SOURCE.hospitals[hid].passwords.admin);
  assert.equal(r.role, 'admin');
  assert.deepEqual(r.adminHospitals, [hid]);
  tokens.hospAdmin = r.token;
  tokens.hospAdminId = hid;
});

test('owner can sign in as a lower role', async () => {
  const r = await login(PW.owner, { roleHint: 'user' });
  assert.equal(r.role, 'user');
});

test('guests get the roster without phone numbers', async () => {
  const rows = await loadAll(null);
  const residents = rows.filter(r => r[0] === 'resident');
  assert.equal(residents.length, SOURCE.residents.length);
  assert.ok(residents.every(r => r[5].phone === undefined));
  assert.ok(rows.filter(r => r[0] === 'hospital').every(r => r[5].names === undefined));
});

test('signed-in users get the full database, identical to the source', async () => {
  const rows = await loadAll(tokens.user);
  const db = HubSync.compose(rows);
  assert.equal(db.residents.length, SOURCE.residents.length);
  assert.ok(db.residents.some(r => r.phone));
  for (const [hid, h] of Object.entries(SOURCE.hospitals)) {
    assert.equal(db.hospitals[hid].schedule.length, h.schedule.length, hid);
  }
  assert.equal(JSON.stringify(db).includes(PW.owner), false, 'no passwords in data');
});

test('a user can edit a duty but not hospital settings', async () => {
  const rows = await loadAll(tokens.user);
  const sched = rows.find(r => r[0] === 'sched');
  const hosp = rows.find(r => r[0] === 'hospital');
  const r = await call('POST', '/api/sync', {
    token: tokens.user,
    body: { msg: 'test', ops: [
      { c: 'sched', id: sched[1], h: sched[2], o: sched[3], bv: sched[4], d: { ...sched[5], note: 'edited' } },
      { c: 'hospital', id: hosp[1], h: hosp[2], o: hosp[3], bv: hosp[4], d: { ...hosp[5], name_ar: 'hacked' } },
    ] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.applied, [[0, sched[4] + 1]]);
  assert.deepEqual(r.data.rejected, [1]);
});

test('a stale write gets a conflict with the current version instead of overwriting', async () => {
  const rows = await loadAll(tokens.user);
  const sched = rows.filter(r => r[0] === 'sched')[1];
  const op = v => ({ c: 'sched', id: sched[1], h: sched[2], o: sched[3], bv: v, d: { ...sched[5], note: 'first' } });
  const first = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [op(sched[4])] } });
  assert.equal(first.data.applied.length, 1);
  const stale = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ ...op(sched[4]), d: { ...sched[5], note: 'second' } }] } });
  assert.equal(stale.data.applied.length, 0);
  assert.equal(stale.data.conflicts.length, 1);
  const [, v, data] = stale.data.conflicts[0];
  assert.equal(v, sched[4] + 1);
  assert.equal(JSON.parse(data).note, 'first');
});

test('stored text cannot carry HTML or break out of inline handlers', async () => {
  const hid = Object.keys(SOURCE.hospitals)[0];
  const id = `${hid}:xsstest`;
  const evil = `<img src=x onerror=alert(1)>"\\');alert(2);//\`x\``;
  const r = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ c: 'sched', id, h: hid, o: 9998, bv: 0, d: { date: '02/01/2030', specCode: 'GS', name: evil } }] } });
  assert.equal(r.data.applied.length, 1);
  const row = (await loadAll(tokens.user)).find(x => x[1] === id);
  assert.equal(/[<>"'`\\]/.test(row[5].name), false, row[5].name);
  assert.ok(row[5].name.includes('alert'), 'text kept, only dangerous characters changed');
  await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ c: 'sched', id, bv: 1, del: 1 }] } });
});

test('create and delete a duty', async () => {
  const hid = Object.keys(SOURCE.hospitals)[0];
  const id = `${hid}:testentry`;
  const created = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ c: 'sched', id, h: hid, o: 9999, bv: 0, d: { date: '01/01/2030', specCode: 'GS', name: 'Test' } }] } });
  assert.deepEqual(created.data.applied, [[0, 1]]);
  const dup = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ c: 'sched', id, h: hid, o: 9999, bv: 0, d: { date: 'x' } }] } });
  assert.equal(dup.data.conflicts.length, 1, 'creating an existing id is a conflict');
  const deleted = await call('POST', '/api/sync', { token: tokens.user, body: { ops: [{ c: 'sched', id, bv: 1, del: 1 }] } });
  assert.deepEqual(deleted.data.applied, [[0, 0]]);
  const rows = await loadAll(tokens.user);
  assert.equal(rows.some(r => r[1] === id), false);
});

test('contact taps increment atomically', async () => {
  const rows = await loadAll(tokens.user);
  const sched = rows.filter(r => r[0] === 'sched')[5];
  const before = sched[5].VisitCount || 0;
  await Promise.all([1, 2, 3].map(() => call('POST', '/api/visit', { token: tokens.user, body: { id: sched[1] } })));
  const after = (await loadAll(tokens.user)).find(r => r[1] === sched[1]);
  assert.equal(after[5].VisitCount, before + 3);
});

test('ICU: anaesthesia may edit, admin may not', async () => {
  const rows = await loadAll(tokens.user);
  const icu = rows.find(r => r[0] === 'icu');
  const op = { c: 'icu', id: icu[1], h: icu[2], o: 0, bv: icu[4], d: { ...icu[5], occupiedBeds: 1 } };
  const asAdmin = await call('POST', '/api/sync', { token: tokens.admin, body: { ops: [op] } });
  assert.deepEqual(asAdmin.data.rejected, [0]);
  const asIcu = await call('POST', '/api/sync', { token: tokens.anaesthesia, body: { ops: [op] } });
  assert.equal(asIcu.data.applied.length, 1);
});

test('a hospital admin can only edit their own hospital', async () => {
  const rows = await loadAll(tokens.hospAdmin);
  const own = rows.find(r => r[0] === 'hospital' && r[1] === tokens.hospAdminId);
  const other = rows.find(r => r[0] === 'hospital' && r[1] !== tokens.hospAdminId);
  const r = await call('POST', '/api/sync', { token: tokens.hospAdmin, body: { ops: [
    { c: 'hospital', id: own[1], h: own[2], o: own[3], bv: own[4], d: own[5] },
    { c: 'hospital', id: other[1], h: other[2], o: other[3], bv: other[4], d: other[5] },
  ] } });
  assert.equal(r.data.applied.length, 1);
  assert.deepEqual(r.data.rejected, [1]);
});

test('passwords are owner-only and can be changed', async () => {
  assert.equal((await call('GET', '/api/secrets', { token: tokens.admin })).status, 403);
  const r = await call('GET', '/api/secrets', { token: tokens.owner });
  assert.equal(r.data.secrets.global.user, PW.user);
  const hid = Object.keys(SOURCE.hospitals)[0];
  await call('PUT', '/api/secrets', { token: tokens.owner, body: { secrets: { [hid]: { user: 'temp-user-pw' } } } });
  assert.equal((await login('temp-user-pw')).role, 'user');
  await call('PUT', '/api/secrets', { token: tokens.owner, body: { secrets: { [hid]: { user: SOURCE.hospitals[hid].passwords.user } } } });
});

test('ER data: admins only', async () => {
  const op = { c: 'er', id: 'hosp_hub_emergency_sched_test_2026_10', h: 'test', o: 0, bv: 0, d: { a: 1 } };
  assert.deepEqual((await call('POST', '/api/sync', { token: tokens.user, body: { ops: [op] } })).data.rejected, [0]);
  assert.equal((await call('POST', '/api/sync', { token: tokens.admin, body: { ops: [op] } })).data.applied.length, 1);
  assert.equal((await call('GET', '/api/er', { token: tokens.user })).status, 403);
  const rows = await loadAll(tokens.admin, '/api/er');
  assert.ok(rows.some(r => r[1] === op.id));
  assert.equal((await loadAll(tokens.admin)).some(r => r[0] === 'er'), false, 'ER rows are not in the main download');
});

test('history keeps the previous version of edited rows', async () => {
  const r = await call('GET', '/api/history?limit=5', { token: tokens.owner });
  assert.ok(r.data.results.length > 0);
});

test('forged and tampered tokens are rejected', async () => {
  const [body, sig] = tokens.user.split('.');
  const forged = Buffer.from(JSON.stringify({ r: 'owner', h: ['*'], e: Date.now() + 1e9, g: 1 })).toString('base64url') + '.' + sig;
  assert.equal((await call('GET', '/api/secrets', { token: forged })).status, 401);
  assert.equal((await call('GET', '/api/session', { token: body + '.x' })).status, 401);
});

test('repeated wrong passwords are rate limited', async () => {
  let last;
  for (let i = 0; i < 22; i++) last = await call('POST', '/api/login', { body: { password: 'wrong' + i } });
  assert.equal(last.status, 429);
});
