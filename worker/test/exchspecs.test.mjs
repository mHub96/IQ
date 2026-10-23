// Residents exchange duties only in the specialties their name can be put in (exchspecs.js); the
// hospital's admins and the owner everywhere.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/exchspecs.test.mjs
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
const t = {};
const ID = n => `${t.h}:exchspec-${RUN}-${n}`;
const entry = spec => ({ date: '01/01/2030', specCode: spec, name: 'د. اختبار ' + RUN, timestamp: '08:00', VisitCount: 0 });
const put = (token, n, spec, bv = 0) => call('POST', '/api/sync', { token, body: { msg: 'exchspecs test', ops: [{ c: 'sched', id: ID(n), h: t.h, o: 99000, bv, d: entry(spec) }] } });
const del = (token, n, bv) => call('POST', '/api/sync', { token, body: { msg: 'exchspecs test', ops: [{ c: 'sched', id: ID(n), bv, del: 1 }] } });
const applied = r => r.status === 200 && r.data.applied.length === 1 ? r.data.applied[0][1] : 0;
const refused = r => r.status === 200 && r.data.rejected.length === 1;

test('setup: a resident account, their own specialty and one they are not in', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  const all = await rows(t.owner);
  const hospitals = new Map(all.filter(r => r[0] === 'hospital').map(r => [r[1], r[5]]));
  const taken = new Set(((await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts || []).map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  // A specialty is "plain" when only its own residents go in it (no pool, parent or children).
  const plain = (specs, s) => !s.isClone && !s.parentSpec && !(s.acceptPool || []).length && !specs.some(x => x.parentSpec === s.id);
  for (const res of residents) {
    const h = (res.hospitals || [])[0], specs = hospitals.get(h)?.specialties || [];
    const own = res.dept || res.spec;
    if (!h || taken.has(res.id) || res.active === false || phones.get(res.phone) !== 1 || !/^\+?9647\d{9}$/.test(res.phone || '')) continue;
    const mine = specs.find(s => s.id === own && plain(specs, s));
    const other = specs.find(s => s.id !== own && plain(specs, s));
    if (mine && other && res.name.replace(/^د\.?\s*/, '').trim().split(/\s+/).length >= 2) { Object.assign(t, { res, h, own, other: other.id }); break; }
  }
  assert.ok(t.res, 'a resident with a plain specialty');
  const username = 'xsp_' + RUN;
  const up = await call('POST', '/api/accounts/signup', { body: { hosp: t.h, name: t.res.name, phone: t.res.phone, username, key: await deriveKey(username, 'pass-X-1'), sex: 'm' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  t.accountId = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'approve' } })).data.account.status, 'active');
  const li = (await call('POST', '/api/accounts/login', { body: { username, key: await deriveKey(username, 'pass-X-1'), deviceId: 'deviceX-' + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  assert.ok(li.token, JSON.stringify(li));
  t.tok = li.token;
  t.approvalWas = ((await call('GET', '/api/exchange/settings', { token: t.owner })).data.on || []).includes(t.h);
  if (t.approvalWas) await call('POST', '/api/exchange/settings', { token: t.owner, body: { hosp: t.h, on: false } });
});

test('the resident: a duty in another specialty is refused', async () => {
  assert.ok(refused(await put(t.tok, 'a', t.other)));
});

test('the resident: their own specialty is saved, changed and deleted', async () => {
  const v = applied(await put(t.tok, 'b', t.own));
  assert.ok(v, 'saved');
  const v2 = applied(await put(t.tok, 'b', t.own, v));
  assert.ok(v2, 'changed');
  assert.equal((await del(t.tok, 'b', v2)).data.applied.length, 1, 'deleted');
});

test('the resident cannot move or delete another specialty\'s duty', async () => {
  const v = applied(await put(t.admin, 'c', t.other));
  assert.ok(v, 'the admin saves it');
  assert.ok(refused(await put(t.tok, 'c', t.own, v)), 'moved into their own specialty: refused');
  assert.ok(refused(await del(t.tok, 'c', v)), 'deleted: refused');
  assert.equal((await del(t.admin, 'c', v)).data.applied.length, 1, 'the admin deletes it');
});

test('approval on: a request in another specialty is refused', async () => {
  assert.equal((await call('POST', '/api/exchange/settings', { token: t.owner, body: { hosp: t.h, on: true } })).status, 200);
  const ask = spec => call('POST', '/api/exchange/request', { token: t.tok, body: { h: t.h, date: '01/01/2030', spec, oldName: 'د. لا أحد ' + RUN, newName: t.res.name } });
  const theirs = await ask(t.other);
  assert.equal(theirs.status, 403);
  assert.equal(theirs.data.error, 'not_your_specialty');
  // Their own specialty passes this check (there is no such duty).
  assert.equal((await ask(t.own)).data.error, 'duty_not_found');
});

test('cleanup', async () => {
  await call('POST', '/api/exchange/settings', { token: t.owner, body: { hosp: t.h, on: !!t.approvalWas } });
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'delete' } })).data.ok, true);
});
