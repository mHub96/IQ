// The general store of specialties is the owner's (specguard.js), store codes can be renamed, and
// rotators found in the hospital database sign up as rotators.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/specguard.test.mjs
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
const row = (all, c, id) => all.find(r => r[0] === c && r[1] === id);
const putOp = (r, d) => ({ c: r[0], id: r[1], h: r[2], o: r[3], bv: r[4], d });
const sync = (token, ops) => call('POST', '/api/sync', { token, body: { msg: 'specguard test', ops } });
const applied = r => r.status === 200 && r.data.applied.length === 1;
const refused = r => r.status === 200 && r.data.rejected.length === 1;
/** The hospital record now, with `change` applied to a copy of the store specialty (or the list). */
async function hospitalWith(change) {
  const all = await rows(t.owner);
  const h = row(all, 'hospital', t.h);
  const d = JSON.parse(JSON.stringify(h[5]));
  change(d);
  return putOp(h, d);
}

test('setup: a hospital with a specialty of the general store', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  const all = await rows(t.owner);
  t.meta = row(all, 'meta', 'globalSpecialties');
  t.allBefore = all;
  const store = t.meta[5].value;
  for (const h of all.filter(r => r[0] === 'hospital')) {
    const s = (h[5].specialties || []).find(x => !x.isClone && store.some(g => g.id === x.id) && x.id !== 'Pe');
    if (s) { t.h = h[1]; t.spec = s.id; t.store = store.find(g => g.id === s.id); break; }
  }
  assert.ok(t.h && t.spec, 'a store specialty in a hospital');
});

test('admin: the store specialty keeps the store\'s name, icon and prefix', async () => {
  for (const [f, v] of [['name_ar', 'اسم آخر ' + RUN], ['icon', '🧪'], ['prefix', 'Mr. '], ['name_en', 'Other ' + RUN]]) {
    const op = await hospitalWith(d => { d.specialties.find(s => s.id === t.spec)[f] = v; });
    assert.ok(refused(await sync(t.admin, [op])), f);
  }
});

test('admin: colour, visibility and drawing sources change; the store\'s values are always accepted', async () => {
  const op = await hospitalWith(d => {
    const s = d.specialties.find(x => x.id === t.spec);
    Object.assign(s, { color: '#123456', acceptPool: ['GS'], name_ar: t.store.name_ar || t.store.id, icon: t.store.icon || '🏥' });
  });
  assert.ok(applied(await sync(t.admin, [op])), JSON.stringify((await sync(t.admin, [])).data));
});

test('admin: the hospital\'s own specialty is theirs to add, edit and remove', async () => {
  const id = 'ZQ' + RUN.slice(0, 3).toUpperCase();
  assert.ok(applied(await sync(t.admin, [await hospitalWith(d => { d.specialties.push({ id, name_ar: 'خاص ' + RUN, icon: '🩺', custom: true, enabled: true }); })])), 'added');
  assert.ok(applied(await sync(t.admin, [await hospitalWith(d => { d.specialties.find(s => s.id === id).name_ar = 'خاص معدّل ' + RUN; })])), 'renamed');
  assert.ok(applied(await sync(t.admin, [await hospitalWith(d => { d.specialties = d.specialties.filter(s => s.id !== id); })])), 'removed');
});

test('admin: the general store itself is refused; the owner writes it', async () => {
  const all = await rows(t.owner);
  const m = row(all, 'meta', 'globalSpecialties');
  const changed = { ...m[5], value: m[5].value.map(g => g.id === t.spec ? { ...g, name_ar: 'اختبار ' + RUN } : g) };
  assert.ok(refused(await sync(t.admin, [putOp(m, changed)])));
  assert.ok(applied(await sync(t.owner, [putOp(m, changed)])), 'owner');
  const back = row(await rows(t.owner), 'meta', 'globalSpecialties');
  assert.ok(applied(await sync(t.owner, [putOp(back, m[5])])), 'owner restores it');
});

test('a store code renamed: only the owner moves the server records', async () => {
  assert.equal((await call('POST', '/api/specialty-id', { token: t.admin, body: { from: 'QQ1', to: 'QQ2' } })).status, 403);
  assert.equal((await call('POST', '/api/specialty-id', { token: t.owner, body: { from: 'QQ1', to: 'bad code' } })).status, 400);
  const ok = await call('POST', '/api/specialty-id', { token: t.owner, body: { from: 'QQ1' + RUN, to: 'QQ2' + RUN } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.requests, 0);
});

test('rotators in the hospital database: offered and given the rotator sign-up, linked to their record', async () => {
  const all = await rows(t.owner);
  const accounts = (await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts;
  const taken = new Set(accounts.map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  const store = row(all, 'meta', 'globalSpecialties')[5].value;
  const res = residents.find(r => (r.hospitals || [])[0] && !taken.has(r.id) && phones.get(r.phone) === 1 && /^\+?9647\d{9}$/.test(r.phone || '')
    && store.some(g => g.id === r.spec && !g.parentSpec) && r.name.replace(/^د\.?\s*/, '').trim().split(/\s+/).length >= 2);
  assert.ok(res, 'a resident');
  const hosp = res.hospitals[0];
  const check = () => call('POST', '/api/accounts/check', { body: { hosp, name: res.name, phone: res.phone } });
  assert.equal((await check()).data.rotator, false, 'a resident of a regular specialty');

  // Their specialty becomes the rotators' (by its English name, as "Rotator" in the live store).
  const m = row(all, 'meta', 'globalSpecialties');
  const asRotator = { ...m[5], value: m[5].value.map(g => g.id === res.spec ? { ...g, name_en: 'Rotator' } : g) };
  assert.ok(applied(await sync(t.owner, [putOp(m, asRotator)])));
  try {
    const c = await check();
    assert.equal(c.data.match, true);
    assert.equal(c.data.rotator, true, 'flagged as a rotator');
    const username = 'rot_' + RUN;
    const key = await deriveKey(username, 'pass-R-1');
    const asResident = await call('POST', '/api/accounts/signup', { body: { hosp, name: res.name, phone: res.phone, username, key, sex: 'm' } });
    assert.equal(asResident.status, 409);
    assert.equal(asResident.data.error, 'is_rotator');
    const ro = await call('POST', '/api/accounts/signup-rotator', { body: { hosp, name: res.name, phone: res.phone, username, key, sex: 'm' } });
    assert.equal(ro.status, 200, JSON.stringify(ro.data));
    assert.equal(ro.data.linked, true);
    const acc = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username);
    assert.equal(acc.role, 'rotator');
    assert.equal(acc.resident_id, res.id, 'linked to the record');
    // The same record cannot get a second account.
    const again = await call('POST', '/api/accounts/signup-rotator', { body: { hosp, name: res.name, phone: res.phone, username: username + 'x', key, sex: 'm' } });
    assert.equal(again.data.error, 'already_registered');
    assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: acc.id, action: 'delete' } })).data.ok, true);
  } finally {
    const now = row(await rows(t.owner), 'meta', 'globalSpecialties');
    assert.ok(applied(await sync(t.owner, [putOp(now, m[5])])), 'store restored');
  }
});

test('cleanup: the store specialty back as it was in the hospital', async () => {
  const op = await hospitalWith(d => {
    const s = d.specialties.find(x => x.id === t.spec);
    const orig = row(t.allBefore || [], 'hospital', t.h);
    if (!orig) return;
    Object.assign(s, orig[5].specialties.find(x => x.id === t.spec));
  });
  if (t.allBefore) assert.ok(applied(await sync(t.owner, [op])));
});
