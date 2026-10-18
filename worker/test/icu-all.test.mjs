// The owner's switch that lets every anaesthesia resident edit every hospital's ICU.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/icu-all.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async password => (await call('POST', '/api/login', { body: { password } })).data;
async function rows(token) {
  let after = 0, out = [], page;
  do { page = (await call('GET', `/api/db?after=${after}`, { token })).data; out = out.concat(page.rows); after = page.last; } while (page.more);
  return out;
}
const t = {};
const [H] = Object.keys(DATA.hospitals).filter(h => {
  const p = DATA.hospitals[h].passwords?.anaesthesia;
  return p && p !== DATA.globalPasswords.anaesthesia && !Object.entries(DATA.hospitals).some(([o, x]) => o !== h && x.passwords?.anaesthesia === p);
});

test('setup: an anaesthesia resident of one hospital', async () => {
  assert.ok(H, 'a hospital with its own anaesthesia password');
  const a = await login(DATA.hospitals[H].passwords.anaesthesia);
  assert.equal(a.role, 'anaesthesia');
  assert.deepEqual(a.adminHospitals, [H]);
  t.an = a.token;
  t.owner = (await login(DATA.globalPasswords.owner)).token;
  t.admin = (await login(DATA.globalPasswords.admin)).token;
  assert.equal((await call('GET', '/api/auth-config')).data.icuAll, false, 'off by default');
});

test('off: own hospital only; on: every hospital; only the owner switches it', async () => {
  const all = await rows(t.owner);
  const own = all.find(r => r[0] === 'icu' && r[2] === H);
  const other = all.find(r => r[0] === 'icu' && r[2] && r[2] !== H);
  assert.ok(own && other, 'ICU records of two hospitals');
  const op = (r, note) => ({ c: 'icu', id: r[1], h: r[2], o: r[3], bv: r[4], d: { ...r[5], notes: note } });
  const write = async (r, note) => (await call('POST', '/api/sync', { token: t.an, body: { msg: 'icu', ops: [op(r, note)] } })).data;

  assert.equal((await write(own, 'own')).applied.length, 1);
  assert.deepEqual((await write(other, 'x')).rejected, [0]);

  assert.equal((await call('POST', '/api/icu-access', { token: t.admin, body: { on: true } })).status, 403);
  assert.equal((await call('POST', '/api/icu-access', { token: t.an, body: { on: true } })).status, 403);
  assert.equal((await call('POST', '/api/icu-access', { token: t.owner, body: { on: true } })).data.icuAll, true);
  assert.equal((await call('GET', '/api/auth-config')).data.icuAll, true);
  const fresh = (await rows(t.owner)).find(r => r[1] === other[1]);
  assert.equal((await write(fresh, 'from another hospital')).applied.length, 1);
  // Still only the ICU: other hospitals' rosters stay closed to them.
  const sched = all.find(r => r[0] === 'sched' && r[2] && r[2] !== H);
  const s = await call('POST', '/api/sync', { token: t.an, body: { msg: 'x', ops: [{ c: 'sched', id: sched[1], h: sched[2], o: sched[3], bv: sched[4], d: { ...sched[5], note: 'x' } }] } });
  assert.deepEqual(s.data.rejected, [0]);

  await call('POST', '/api/icu-access', { token: t.owner, body: { on: false } });
  const again = (await rows(t.owner)).find(r => r[1] === other[1]);
  assert.deepEqual((await write(again, 'y')).rejected, [0]);
  assert.equal((await call('GET', '/api/auth-config')).data.icuAll, false);
});
