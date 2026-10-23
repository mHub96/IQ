// Rotators exchange duties only in the rotators' specialty (by its name) and its branches, in their own
// hospital (exchspecs.js). The store specialty is made the rotators' for the test and put back after.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/rotator-exchange.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));
const RUN = Date.now().toString(36).slice(-5);

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
const login = async password => (await call('POST', '/api/login', { body: { password } })).data.token;
async function rows(token) {
  let after = 0, page; const out = [];
  do { page = (await call('GET', `/api/db?after=${after}`, { token })).data; out.push(...page.rows); after = page.last; } while (page.more);
  return out;
}
const row = (all, c, id) => all.find(r => r[0] === c && r[1] === id);
const t = {};
const ID = (h, n) => `${h}:rotx-${RUN}-${n}`;
const put = (token, h, n, spec) => call('POST', '/api/sync', { token, body: { msg: 'rotator exchange test', ops: [{ c: 'sched', id: ID(h, n), h, o: 99000, bv: 0, d: { date: '01/01/2030', specCode: spec, name: 'د. اختبار ' + RUN, timestamp: '08:00', VisitCount: 0 } }] } });
const applied = r => r.status === 200 && r.data.applied.length === 1;
const refused = r => r.status === 200 && r.data.rejected.length === 1;

test('setup: a rotator account and the rotators\' specialty with a branch', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  const all = await rows(t.owner);
  t.meta = row(all, 'meta', 'globalSpecialties');
  const store = t.meta[5].value;
  // A hospital whose specialties include a store parent with a branch (A with ICU, ...) and another one.
  for (const h of all.filter(r => r[0] === 'hospital')) {
    const ids = (h[5].specialties || []).map(s => s.id);
    const parent = store.find(g => ids.includes(g.id) && !g.parentSpec && store.some(b => b.parentSpec === g.id && ids.includes(b.id)));
    if (parent) {
      t.h = h[1]; t.rot = parent.id; t.branch = store.find(b => b.parentSpec === parent.id && ids.includes(b.id)).id;
      t.other = ids.find(id => id !== t.rot && !store.some(g => g.id === id && g.parentSpec === t.rot));
      t.otherHosp = all.find(r => r[0] === 'hospital' && r[1] !== t.h)[1];
      break;
    }
  }
  assert.ok(t.h && t.rot && t.branch && t.other, 'a parent with a branch');
  const asRot = { ...t.meta[5], value: store.map(g => g.id === t.rot ? { ...g, name_en: 'Rotator' } : g) };
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [{ c: 'meta', id: 'globalSpecialties', h: t.meta[2], o: t.meta[3], bv: t.meta[4], d: asRot }] } })).data.applied.length, 1);
  const username = 'rotx_' + RUN, key = await deriveKey(username, 'pass-R-1');
  assert.equal((await call('POST', '/api/accounts/signup-rotator', { body: { hosp: t.h, name: 'روتيتر تجربة اختبار', username, key, sex: 'm' } })).status, 200);
  t.accountId = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'approve', role: 'rotator' } });
  const li = (await call('POST', '/api/accounts/login', { body: { username, key, deviceId: 'deviceR-' + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  assert.ok(li.token, JSON.stringify(li));
  t.tok = li.token;
});

test('a rotator exchanges in the rotators\' specialty and its branches', async () => {
  assert.ok(applied(await put(t.tok, t.h, 'a', t.rot)), 'the specialty');
  assert.ok(applied(await put(t.tok, t.h, 'b', t.branch)), 'its branch');
});

test('not in another specialty, nor in another hospital', async () => {
  assert.ok(refused(await put(t.tok, t.h, 'c', t.other)), 'another specialty');
  assert.ok(refused(await put(t.tok, t.otherHosp, 'd', t.rot)), 'another hospital');
});

test('cleanup', async () => {
  const all = await rows(t.owner);
  const dels = ['a', 'b'].map(n => row(all, 'sched', ID(t.h, n))).filter(Boolean).map(r => ({ c: 'sched', id: r[1], bv: r[4], del: 1 }));
  if (dels.length) await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test cleanup', ops: dels } });
  const m = row(all, 'meta', 'globalSpecialties');
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test cleanup', ops: [{ c: 'meta', id: 'globalSpecialties', h: m[2], o: m[3], bv: m[4], d: t.meta[5] }] } })).data.applied.length, 1);
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'delete' } })).data.ok, true);
});
