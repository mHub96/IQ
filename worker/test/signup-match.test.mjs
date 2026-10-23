// Sign-up matching: the phone number identifies the resident and the first name confirms it; when
// nothing matches the API says why (number under another name, another hospital, name with another number).
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/signup-match.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameTokens } from '../src/names.js';

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
const login = async password => (await call('POST', '/api/login', { body: { password } })).data.token;
const check = (hosp, name, phone) => call('POST', '/api/accounts/check', { body: { hosp, name, phone } });
const local = p => '0' + String(p).replace(/\D/g, '').slice(-10);
const t = {};

test('setup: residents from the database as it is now', async () => {
  const owner = await login(DATA.globalPasswords.owner);
  let after = 0, page; const rows = [];
  do { page = (await call('GET', `/api/db?after=${after}`, { token: owner })).data; rows.push(...page.rows); after = page.last; } while (page.more);
  const residents = rows.filter(r => r[0] === 'resident').map(r => r[5]);
  t.hospitals = rows.filter(r => r[0] === 'hospital').map(r => r[1]);
  const phones = new Map();
  for (const r of residents) phones.set(local(r.phone), (phones.get(local(r.phone)) || 0) + 1);
  const ok = r => (r.hospitals || []).length === 1 && /^\+?9647\d{9}$/.test(r.phone || '') && phones.get(local(r.phone)) === 1;
  t.res = residents.find(r => ok(r) && nameTokens(r.name).length >= 3);
  // A first name of two words that the site joins into one (ابو تراب, عبد الله ...).
  t.joined = residents.find(r => ok(r) && /^(د\.?\s*)?(ابو|أبو|عبد)\s/.test(r.name) && nameTokens(r.name).length >= 2);
  assert.ok(t.res, 'a resident with a three-part name');
});

test('the first name and the phone number are enough', async () => {
  const h = t.res.hospitals[0], parts = t.res.name.replace(/^د\.?\s*/, '').split(/\s+/);
  const first = await check(h, parts[0], local(t.res.phone));
  assert.equal(first.data.match, true, JSON.stringify(first.data));
  assert.equal(first.data.name, t.res.name, 'the database name comes back');
  assert.equal((await check(h, parts[0] + ' اسمخطأ', local(t.res.phone))).data.match, true, 'a wrong second name does not matter');
  assert.equal((await check(h, 'د. ' + parts.join(' '), '+964' + local(t.res.phone).slice(1))).data.match, true, 'full name, international number');
});

test('a joined first name written in two words (ابو تراب)', async (ctx) => {
  if (!t.joined) return ctx.skip('no such name in this snapshot');
  const words = t.joined.name.replace(/^د\.?\s*/, '').split(/\s+/);
  const r = await check(t.joined.hospitals[0], words.slice(0, 2).join(' '), local(t.joined.phone));
  assert.equal(r.data.match, true, JSON.stringify(r.data));
});

test('not found: the reason', async () => {
  const h = t.res.hospitals[0], parts = t.res.name.replace(/^د\.?\s*/, '').split(/\s+/);
  const wrongFirst = await check(h, 'زززز ' + parts[1], local(t.res.phone));
  assert.equal(wrongFirst.data.match, false);
  assert.equal(wrongFirst.data.reason, 'phone_other_name');
  const other = t.hospitals.find(x => x !== h);
  const elsewhere = await check(other, parts[0], local(t.res.phone));
  assert.equal(elsewhere.data.reason, 'other_hospital');
  assert.deepEqual(elsewhere.data.hospitals, [h]);
  const wrongPhone = await check(h, parts.slice(0, 2).join(' '), '07000000009');
  assert.equal(wrongPhone.data.reason, 'name_other_phone');
  assert.equal((await check(h, 'زززز ييييي', '07000000009')).data.reason, 'none');
});
