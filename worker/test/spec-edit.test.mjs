// The per-hospital switch letting residents add and edit the specialist cards of their own specialty
// (or rotation) in their own hospital. Deleting stays with the admins and the owner.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/spec-edit.test.mjs
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
async function directory(token) {
  let after = 0, page, row;
  do {
    page = (await call('GET', `/api/db?after=${after}`, { token })).data;
    row = row || page.rows.find(r => r[0] === 'meta' && r[1] === 'specialists');
    after = page.last;
  } while (page.more);
  return row;
}
/** Writes the directory as `token`, after `change` edits a copy of the current list. */
async function writeDir(token, change) {
  const row = await directory(t.owner);
  const list = JSON.parse(JSON.stringify((row && row[5] && row[5].value) || []));
  const next = change(list) || list;
  const op = { c: 'meta', id: 'specialists', h: row ? row[2] : null, o: row ? row[3] : 0, bv: row ? row[4] : 0, d: { ...(row ? row[5] : {}), value: next } };
  return (await call('POST', '/api/sync', { token, body: { msg: 'spec-edit test', ops: [op] } })).data;
}
const ok = r => r && r.applied && r.applied.length === 1;
const refused = r => r && Array.isArray(r.rejected) && r.rejected.length === 1;

// A resident with a unique valid phone, a two-part name and a specialty, in a hospital that has a second one.
const phones = new Map();
for (const r of DATA.residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
const RES = DATA.residents.find(r => (r.hospitals || []).length && r.spec && r.spec !== 'REF' && /^\+?9647\d{9}$/.test(r.phone || '')
  && phones.get(r.phone) === 1 && r.name.replace(/^د\.?\s*/, '').trim().split(/\s+/).length >= 2);
const H = RES && RES.hospitals[0];
const OTHER_H = Object.keys(DATA.hospitals).find(h => h !== H);
const OTHER_SPEC = ['GS', 'M', 'OR', 'NS', 'Pe'].find(c => ![RES.spec, RES.dept].includes(c));
const t = {};
const card = (id, extra = {}) => ({ id, name: 'د. اختبار ' + id, title: 'أخصائي', spec: RES.spec, specName: RES.spec, hospitals: [H], phone: '', clinic: '', notes: '', active: true, schedule: { clinicDays: [], theatreDays: [] }, ...extra });
const MINE = 'spec-doc-test-mine-' + RUN, THEIRS = 'spec-doc-test-theirs-' + RUN;

test('setup: a resident with a personal account', async () => {
  assert.ok(RES && H && OTHER_H && OTHER_SPEC, 'a resident in the snapshot');
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  t.user = await login(DATA.globalPasswords.user);
  const hp = DATA.hospitals[OTHER_H].passwords?.admin;
  if (hp && hp !== DATA.globalPasswords.admin) t.otherAdmin = await login(hp);
  const username = 'spec_' + RUN;
  const up = await call('POST', '/api/accounts/signup', { body: { hosp: H, name: RES.name, phone: RES.phone, username, key: await deriveKey(username, 'pass-S-1'), sex: 'm' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const pending = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username);
  t.accountId = pending.id;
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'approve' } })).data.account.status, 'active');
  const li = (await call('POST', '/api/accounts/login', { body: { username, key: await deriveKey(username, 'pass-S-1'), deviceId: 'deviceS-' + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  assert.ok(li.token, JSON.stringify(li));
  t.res = li.token;
  await call('POST', '/api/specialists/settings', { token: t.owner, body: { hosp: H, on: false } });
});

test('settings: everyone signed in reads them; the resident learns their hospital and specialties', async () => {
  assert.equal((await call('GET', '/api/specialists/settings')).status, 401);
  const me = (await call('GET', '/api/specialists/settings', { token: t.res })).data;
  assert.equal(me.me.hosp, H);
  assert.ok(me.me.codes.includes(String(RES.spec).toUpperCase()));
  assert.ok(!me.on.includes(H));
  assert.equal((await call('GET', '/api/specialists/settings', { token: t.user })).data.me, null, 'shared password: no identity');
});

test('switched off: the resident cannot add a card', async () => {
  assert.ok(refused(await writeDir(t.res, l => { l.unshift(card(MINE)); })));
});

test('only the owner and that hospital\'s admins switch it', async () => {
  const sw = (token, on) => call('POST', '/api/specialists/settings', { token, body: { hosp: H, on } });
  assert.equal((await sw(t.res, true)).status, 403);
  assert.equal((await sw(t.user, true)).status, 403);
  if (t.otherAdmin) assert.equal((await sw(t.otherAdmin, true)).status, 403);
  assert.equal((await call('POST', '/api/specialists/settings', { token: t.owner, body: { hosp: 'x y', on: true } })).status, 400);
  const on = await sw(t.owner, true);
  assert.equal(on.status, 200);
  assert.ok(on.data.on.includes(H));
  assert.equal((await sw(t.admin, true)).status, 200, 'the all-hospitals admin too');
});

test('switched on: own specialty in own hospital only, no deleting', async () => {
  assert.ok(ok(await writeDir(t.res, l => { l.unshift(card(MINE)); })), 'adds a card');
  assert.ok(ok(await writeDir(t.res, l => { l.find(s => s.id === MINE).phone = '07700000000'; })), 'edits it');
  assert.ok(ok(await writeDir(t.res, l => { Object.assign(l.find(s => s.id === MINE), { clinic: 'عيادة', schedule: { clinicDays: ['الأحد'], theatreDays: [] } }); })), 'and its details');
  assert.ok(refused(await writeDir(t.res, l => { l.unshift(card(THEIRS, { spec: OTHER_SPEC })); })), 'another specialty');
  assert.ok(refused(await writeDir(t.res, l => { l.unshift(card(THEIRS, { hospitals: [OTHER_H] })); })), 'another hospital');
  assert.ok(refused(await writeDir(t.res, l => { l.find(s => s.id === MINE).spec = OTHER_SPEC; })), 'moving a card out of the specialty');
  assert.ok(refused(await writeDir(t.res, l => l.filter(s => s.id !== MINE))), 'deleting');
  // A card of another specialty (added by the owner) stays out of reach.
  assert.ok(ok(await writeDir(t.owner, l => { l.unshift(card(THEIRS, { spec: OTHER_SPEC })); })));
  assert.ok(refused(await writeDir(t.res, l => { l.find(s => s.id === THEIRS).phone = '07711111111'; })));
});

test('switched off again: back to the admins and the owner', async () => {
  assert.equal((await call('POST', '/api/specialists/settings', { token: t.owner, body: { hosp: H, on: false } })).status, 200);
  assert.ok(refused(await writeDir(t.res, l => { l.find(s => s.id === MINE).phone = '07722222222'; })));
});

test('cleanup', async () => {
  assert.ok(ok(await writeDir(t.owner, l => l.filter(s => s.id !== MINE && s.id !== THEIRS))));
  assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'delete' } })).data.ok, true);
});
