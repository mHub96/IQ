// Rotators in the hospital database (rotators.js): the number is required at sign-up; with the hospital's
// number check on, only a rotator found in the database signs up; otherwise the approval adds the rotator
// under the rotators' specialty (and the cron does it for rotators approved before). A store specialty
// named "Rotator" is added for the test and everything is put back after.
// Run: API_BASE=http://127.0.0.1:8890 node --test --test-concurrency=1 worker/test/rotator-db.test.mjs
// (the local Worker started with --test-scheduled, for the cron step)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));
const RUN = Date.now().toString(36).slice(-5);
const SPEC = 'RT' + RUN.toUpperCase();
const P = String(Date.now() % 1000000).padStart(6, '0');
const phone = n => '0799' + P + n; // 07 + 9 digits
const NAMES = ['سامر روتيتر اختبار', 'ليث روتيتر اختبار', 'هدى روتيتر اختبار', 'نور روتيتر اختبار'];

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
async function rows(token) {
  let after = 0, page; const out = [];
  do { page = (await call('GET', `/api/db?after=${after}`, { token })).data; out.push(...page.rows); after = page.last; } while (page.more);
  return out;
}
const row = (all, c, id) => all.find(r => r[0] === c && r[1] === id);
const t = { accounts: [] };
const signup = async (name, ph, n) => {
  const username = `rdb${n}_${RUN}`;
  const r = await call('POST', '/api/accounts/signup-rotator', { body: { hosp: t.h, name, phone: ph, username, key: await deriveKey(username, 'Pass-1234'), sex: 'm' } });
  if (r.status === 200) t.accounts.push((await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id);
  return r;
};
const account = async id => (await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts.find(a => a.id === id);
const lastId = () => t.accounts[t.accounts.length - 1];

test('setup: a store specialty named Rotator, missing from the hospital', async () => {
  t.owner = (await call('POST', '/api/login', { body: { password: DATA.globalPasswords.owner } })).data.token;
  const all = await rows(t.owner);
  t.meta = row(all, 'meta', 'globalSpecialties');
  t.h = all.find(r => r[0] === 'hospital')[1];
  t.hospBefore = JSON.parse(JSON.stringify(row(all, 'hospital', t.h)[5]));
  const value = [...t.meta[5].value, { id: SPEC, name_en: 'Rotator', name_ar: 'مقيم دوري', icon: '🔄', prefix: 'د. ' }];
  const r = await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [{ c: 'meta', id: 'globalSpecialties', h: t.meta[2], o: t.meta[3], bv: t.meta[4], d: { ...t.meta[5], value } }] } });
  assert.equal(r.data.applied.length, 1);
  t.checkWas = ((await call('GET', '/api/accounts/rotator-check', { token: t.owner })).data.on || []).includes(t.h);
});

test('the number is required', async () => {
  assert.equal((await signup(NAMES[0], '', 0)).data.error, 'bad_phone');
  assert.equal((await signup(NAMES[0], '12345', 0)).data.error, 'bad_phone');
});

test('the check switch: owner and admins only; on, an unknown rotator is refused', async () => {
  assert.equal((await call('POST', '/api/accounts/rotator-check', { body: { hosp: t.h, on: true } })).status, 401);
  assert.deepEqual((await call('POST', '/api/accounts/rotator-check', { token: t.owner, body: { hosp: t.h, on: true } })).data.on.includes(t.h), true);
  const c = (await call('POST', '/api/accounts/check-rotator', { body: { hosp: t.h, name: NAMES[0], phone: phone(1) } })).data;
  assert.equal(c.check, true);
  assert.equal(c.match, false);
  assert.equal((await signup(NAMES[0], phone(1), 0)).data.error, 'no_match');
});

test('off: the request goes through, and the approval adds the rotator to the database', async () => {
  await call('POST', '/api/accounts/rotator-check', { token: t.owner, body: { hosp: t.h, on: false } });
  assert.equal((await call('POST', '/api/accounts/check-rotator', { body: { hosp: t.h, name: NAMES[0], phone: phone(1) } })).data.check, false);
  const r = await signup(NAMES[0], phone(1), 1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, false);
  assert.equal((await account(lastId())).resident_id, null, 'not in the database before the approval');
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: lastId(), action: 'approve' } });
  const acc = await account(lastId());
  assert.ok(acc.resident_id, 'linked after the approval');
  const all = await rows(t.owner);
  const rec = row(all, 'resident', acc.resident_id);
  assert.ok(rec, 'the record exists');
  assert.equal(rec[5].spec, SPEC);
  assert.equal(rec[5].dept, SPEC);
  assert.equal(rec[5].name, 'د. ' + NAMES[0]);
  assert.equal(rec[5].phone, '+964' + phone(1).slice(1));
  assert.deepEqual(rec[5].hospitals, [t.h]);
  assert.equal(acc.name, 'د. ' + NAMES[0], 'the account takes the database name');
  const hosp = row(all, 'hospital', t.h)[5];
  assert.ok(hosp.specialties.some(s => s.id === SPEC), 'the rotators specialty was put in the hospital');
  assert.ok(hosp.names.some(n => n.id === acc.resident_id), 'and the hospital copy of its residents');
  t.records = [acc.resident_id];
});

test('on: a rotator in the database signs up (linked); the same one again is already registered', async () => {
  await call('POST', '/api/accounts/rotator-check', { token: t.owner, body: { hosp: t.h, on: true } });
  const id = 'res-rdb-' + RUN;
  const put = await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [{ c: 'resident', id, o: 99999, bv: 0, d: { id, name: 'د. ' + NAMES[1], phone: '+964' + phone(2).slice(1), spec: SPEC, tag: SPEC, dept: SPEC, department: SPEC, active: true, hospitals: [t.h] } }] } });
  assert.equal(put.data.applied.length, 1);
  t.records.push(id);
  const c = (await call('POST', '/api/accounts/check-rotator', { body: { hosp: t.h, name: NAMES[1], phone: phone(2) } })).data;
  assert.equal(c.match, true, JSON.stringify(c));
  const r = await signup(NAMES[1], phone(2), 2);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, true);
  assert.equal((await account(lastId())).resident_id, id);
  assert.equal((await signup(NAMES[1], phone(2), 3)).data.error, 'already_registered');
  const before = (await rows(t.owner)).filter(x => x[0] === 'resident').length;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: lastId(), action: 'approve' } });
  assert.equal((await rows(t.owner)).filter(x => x[0] === 'resident').length, before, 'a linked rotator adds nothing');
  await call('POST', '/api/accounts/rotator-check', { token: t.owner, body: { hosp: t.h, on: false } });
});

test('the cron: rotators approved before get an entry (or their existing one, by the exact name)', async () => {
  // The hospital without the rotators' specialty again: the run puts it back once, for two rotators.
  let all0 = await rows(t.owner);
  const h0 = row(all0, 'hospital', t.h);
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [{ c: 'hospital', id: t.h, h: h0[2], o: h0[3], bv: h0[4], d: { ...h0[5], specialties: h0[5].specialties.filter(s => s.id !== SPEC) } }] } })).data.applied.length, 1);
  // Active without the approval path ("enable"), as accounts approved before entries were added.
  await signup(NAMES[2], phone(4), 4);
  const noEntry = lastId();
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: noEntry, action: 'enable' } });
  await signup('رامي روتيتر اختبار', phone(6), 6);
  const noEntry2 = lastId();
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: noEntry2, action: 'enable' } });
  const id = 'res-rdb2-' + RUN;
  await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test', ops: [{ c: 'resident', id, o: 99999, bv: 0, d: { id, name: 'د. ' + NAMES[3], phone: 'رقم غير متوفر', spec: SPEC, tag: SPEC, dept: SPEC, department: SPEC, active: true, hospitals: [t.h] } }] } });
  t.records.push(id);
  await signup(NAMES[3], phone(5), 5);
  const byName = lastId();
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: byName, action: 'enable' } });
  assert.equal((await account(noEntry)).resident_id, null);
  const cron = await fetch(BASE + '/__scheduled?cron=' + encodeURIComponent('*/10 * * * *'));
  assert.equal(cron.status, 200, 'start the local Worker with --test-scheduled');
  const a = await account(noEntry), b = await account(byName);
  assert.ok(a.resident_id && a.resident_id.startsWith('res-'), 'added');
  assert.equal(b.resident_id, id, 'linked to the entry with the same name');
  const all = await rows(t.owner);
  assert.equal(row(all, 'resident', a.resident_id)[5].phone, '+964' + phone(4).slice(1));
  t.records.push(a.resident_id);
  const a2 = await account(noEntry2);
  assert.ok(a2.resident_id && a2.resident_id !== a.resident_id, 'the second one added in the same run');
  t.records.push(a2.resident_id);
  assert.equal(row(all, 'hospital', t.h)[5].specialties.filter(s => s.id === SPEC).length, 1, 'the specialty put back once');
});

test('cleanup', async () => {
  for (const id of t.accounts) await call('POST', '/api/accounts/decide', { token: t.owner, body: { id, action: 'delete' } });
  const all = await rows(t.owner);
  const dels = (t.records || []).map(id => row(all, 'resident', id)).filter(Boolean).map(r => ({ c: 'resident', id: r[1], bv: r[4], del: 1 }));
  const h = row(all, 'hospital', t.h);
  const hosp = { ...h[5], specialties: h[5].specialties.filter(s => s.id !== SPEC), names: (h[5].names || []).filter(n => !(t.records || []).includes(n.id)) };
  const m = row(all, 'meta', 'globalSpecialties');
  const r = await call('POST', '/api/sync', { token: t.owner, body: { msg: 'test cleanup', ops: [...dels,
    { c: 'hospital', id: t.h, h: h[2], o: h[3], bv: h[4], d: hosp },
    { c: 'meta', id: 'globalSpecialties', h: m[2], o: m[3], bv: m[4], d: t.meta[5] }] } });
  assert.equal(r.data.applied.length, dels.length + 2, JSON.stringify(r.data));
  await call('POST', '/api/accounts/rotator-check', { token: t.owner, body: { hosp: t.h, on: !!t.checkWas } });
  const after = row(await rows(t.owner), 'hospital', t.h)[5];
  assert.equal(after.specialties.length, t.hospBefore.specialties.length, 'the hospital specialties are back');
});
