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
  assert.equal((await call('POST', '/api/accounts/signup-rotator', { body: { hosp: t.h, name: 'روتيتر تجربة اختبار', phone: '0799' + String(Date.now() % 10000000).padStart(7, '0'), username, key, sex: 'm' } })).status, 200);
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

test('approval on: a linked rotator holding the duty decides first; no account, straight to the admins', async () => {
  const all = await rows(t.owner);
  const accounts = (await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts;
  const taken = new Set(accounts.map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  const mine = residents.filter(r => (r.hospitals || []).includes(t.h) && r.spec === t.rot && r.active !== false && !taken.has(r.id) && phones.get(r.phone) === 1 && /^\+?9647\d{9}$/.test(r.phone || ''));
  assert.ok(mine.length >= 2, 'two records of the rotators specialty');
  const [holder, noAccount] = mine;
  // The holder signs up as a rotator (linked to their record) and is approved.
  const username = 'rotxh_' + RUN, key = await deriveKey(username, 'pass-R-2');
  const su = await call('POST', '/api/accounts/signup-rotator', { body: { hosp: t.h, name: holder.name, phone: holder.phone, username, key, sex: 'm' } });
  assert.equal(su.data.linked, true, JSON.stringify(su.data));
  t.holderId = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.holderId, action: 'approve', role: 'rotator' } });
  const hl = (await call('POST', '/api/accounts/login', { body: { username, key, deviceId: 'deviceH-' + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  // Two duties in the rotators' specialty: the holder's and one of a resident without an account.
  const duty = (n, name) => ({ c: 'sched', id: ID(t.h, n), h: t.h, o: 99001, bv: 0, d: { date: '02/01/2030', specCode: t.rot, name, timestamp: '08:00', VisitCount: 0 } });
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [duty('h', holder.name), duty('n', noAccount.name)] } })).data.applied.length, 2);
  t.approvalWas = ((await call('GET', '/api/exchange/settings', { token: t.owner })).data.on || []).includes(t.h);
  await call('POST', '/api/exchange/settings', { token: t.owner, body: { hosp: t.h, on: true } });
  const ask = oldName => call('POST', '/api/exchange/request', { token: t.tok, body: { h: t.h, date: '02/01/2030', spec: t.rot, oldName, newName: 'روتيتر تجربة اختبار' } });
  const r1 = await ask(holder.name);
  assert.equal(r1.data.status, 'owner_pending', JSON.stringify(r1.data));
  const forHolder = (await call('GET', '/api/exchange', { token: hl.token })).data.requests.find(x => x.id === r1.data.id);
  assert.equal(forHolder && forHolder.canOwnerDecide, true, 'the linked rotator decides');
  assert.equal((await call('POST', '/api/exchange/decide', { token: hl.token, body: { id: r1.data.id, approve: true } })).data.status, 'admin_pending');
  const r2 = await ask(noAccount.name);
  assert.equal(r2.data.status, 'admin_pending', 'no account: straight to the admins');
  t.requests = [r1.data.id, r2.data.id];
});

test('cleanup', async () => {
  for (const id of t.requests || []) await call('POST', '/api/exchange/decide', { token: t.owner, body: { id, approve: false, note: 'test' } });
  if (t.approvalWas !== undefined) await call('POST', '/api/exchange/settings', { token: t.owner, body: { hosp: t.h, on: !!t.approvalWas } });
  if (t.holderId) await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.holderId, action: 'delete' } });
  const all = await rows(t.owner);
  const dels = ['a', 'b', 'h', 'n'].map(n => row(all, 'sched', ID(t.h, n))).filter(Boolean).map(r => ({ c: 'sched', id: r[1], bv: r[4], del: 1 }));
  // The approval added the test rotator to the hospital database (rotators.js): that entry goes too.
  const added = ((await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts.find(a => a.id === t.accountId) || {}).resident_id;
  const rec = added && row(all, 'resident', added);
  if (rec) {
    const h = row(all, 'hospital', t.h);
    dels.push({ c: 'resident', id: rec[1], bv: rec[4], del: 1 }, { c: 'hospital', id: t.h, h: h[2], o: h[3], bv: h[4], d: { ...h[5], names: (h[5].names || []).filter(n => n.id !== added) } });
  }
  if (dels.length) await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test cleanup', ops: dels } });
  const m = row(all, 'meta', 'globalSpecialties');
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test cleanup', ops: [{ c: 'meta', id: 'globalSpecialties', h: m[2], o: m[3], bv: m[4], d: t.meta[5] }] } })).data.applied.length, 1);
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'delete' } })).data.ok, true);
});
