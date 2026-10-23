// On-call status of a duty card and contact requests (worker/src/oncall.js).
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/oncall.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dutyDayEnd, fresh } from '../src/oncall.js';
import { dutyDayNow } from '../src/profile.js';

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
const today = dutyDayNow();
const dmy = today.split('-').reverse().join('/');

test('the duty day ends at 08:00 Iraq time the next morning', () => {
  assert.equal(new Date(dutyDayEnd('2026-10-23')).toISOString(), '2026-10-24T05:00:00.000Z');
});

async function account(res, hosp, u) {
  const username = u + '_' + RUN, key = await deriveKey(username, 'pass-O-1');
  const up = await call('POST', '/api/accounts/signup', { body: { hosp, name: res.name, phone: res.phone, username, key, sex: 'm' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const id = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id, action: 'approve' } });
  const li = (await call('POST', '/api/accounts/login', { body: { username, key, deviceId: 'deviceO-' + u + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  return { id, tok: li.token };
}

test('setup: a resident on duty today and a colleague (two accounts)', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  t.savedOptions = (await call('GET', '/api/duty-status/options', { token: t.owner })).data;
  const all = await rows(t.owner);
  const taken = new Set(((await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts || []).map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  const ok = r => (r.hospitals || [])[0] && !taken.has(r.id) && r.active !== false && phones.get(r.phone) === 1 && /^\+?9647\d{9}$/.test(r.phone || '') && r.name.replace(/^د\.?\s*/, '').split(/\s+/).length >= 2;
  t.res = residents.find(r => ok(r) && r.spec === 'GS');
  t.col = residents.find(r => ok(r) && r !== t.res && r.hospitals[0] === t.res.hospitals[0]);
  assert.ok(t.res && t.col, 'two residents');
  t.h = t.res.hospitals[0];
  t.holder = await account(t.res, t.h, 'och');
  t.colleague = await account(t.col, t.h, 'occ');
  t.sched = `${t.h}:oncall-${RUN}`;
  assert.equal((await call('POST', '/api/sync', { token: t.owner, body: { msg: 'oncall test', ops: [{ c: 'sched', id: t.sched, h: t.h, o: 99000, bv: 0, d: { date: dmy, specCode: 'GS', name: t.res.name, timestamp: '08:00', VisitCount: 0 } }] } })).data.applied.length, 1);
});

const card = () => ({ h: t.h, d: dmy, n: t.res.name });
const summary = token => call('GET', `/api/social?h=${t.h}&d=${encodeURIComponent(dmy)}&n=${encodeURIComponent(t.res.name)}`, { token });

test('status options: everyone reads them, only the owner changes them', async () => {
  const got = await call('GET', '/api/duty-status/options', { token: t.admin });
  assert.equal(got.status, 200);
  assert.ok(Array.isArray(got.data.options) && 'autoClearHours' in got.data);
  assert.equal((await call('GET', '/api/duty-status/options')).status, 401);
  const next = { options: [
    { id: 'or', icon: '🩸', label: 'في صالة العمليات', chip: 'في العمليات', skin: 'or', busy: true },
    { id: 'ward', icon: '🛏️', label: 'في الردهة', chip: 'في الردهة', skin: 'not-a-skin', busy: false },
    { id: 'ward', icon: 'x', label: 'duplicate', skin: 'or' },
  ], allowCustom: true, autoClearHours: 6 };
  assert.equal((await call('POST', '/api/duty-status/options', { token: t.admin, body: next })).status, 403, 'admins cannot');
  assert.equal((await call('POST', '/api/duty-status/options', { token: t.holder.tok, body: next })).status, 403);
  const saved = await call('POST', '/api/duty-status/options', { token: t.owner, body: next });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.options.map(o => o.id), ['or', 'ward'], 'duplicates dropped');
  assert.equal(saved.data.options[1].skin, 'night', 'unknown skin replaced');
  assert.equal(saved.data.options[1].busy, false);
  assert.equal((await call('POST', '/api/duty-status/options', { token: t.owner, body: { options: [], allowCustom: false } })).data.error, 'no_options');
});

test('status: only the duty holder sets it; everyone sees it on the card', async () => {
  assert.equal((await call('POST', '/api/duty-status', { token: t.colleague.tok, body: { ...card(), status: 'or' } })).data.error, 'not_your_card');
  const r = await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'or' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.status, { s: 'or', k: 'or', l: 'في العمليات', i: '🩸', b: true });
  assert.equal((await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'consult' } })).data.error, 'bad_status', 'not one of the owner\'s options');
  const ward = await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'ward' } });
  assert.deepEqual(ward.data.status, { s: 'ward', k: 'night', l: 'في الردهة', i: '🛏️', b: false });
  // The residents page: today's statuses of whole hospitals.
  const day = await call('GET', `/api/duty-status/today?h=${t.h}&h=nope`, { token: t.colleague.tok });
  assert.equal(day.status, 200, JSON.stringify(day.data));
  const mine = day.data.statuses.find(x => x.hosp === t.h && x.l === 'في الردهة');
  assert.ok(mine && mine.b === false);
  assert.equal((await call('GET', `/api/duty-status/today?h=${t.h}`)).status, 401);
  assert.equal((await call('GET', '/api/duty-status/today', { token: t.colleague.tok })).status, 400);
  await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'or' } });
  const seen = (await summary(t.colleague.tok)).data.cards[t.res.name];
  assert.equal(seen.st.s, 'or');
  const custom = await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'custom', label: 'في الطوارئ', skin: 'violet' } });
  assert.deepEqual(custom.data.status, { s: 'custom', k: 'violet', l: 'في الطوارئ', i: '⏳', b: true });
  await call('POST', '/api/duty-status/options', { token: t.owner, body: { ...t.savedOptions, allowCustom: false } });
  assert.equal((await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'custom', label: 'x' } })).data.error, 'bad_status', 'own text turned off');
  await call('POST', '/api/duty-status/options', { token: t.owner, body: t.savedOptions });
  await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: 'or' } });
});

test('auto-clear: a status older than the owner\'s time is no longer shown (0 = never)', async () => {
  const h = 3600 * 1000, now = Date.now();
  assert.equal(fresh({ updated_at: now - 5.9 * h }, { autoClearHours: 6 }, now), true);
  assert.equal(fresh({ updated_at: now - 6.1 * h }, { autoClearHours: 6 }, now), false);
  assert.equal(fresh({ updated_at: now - 30 * h }, { autoClearHours: 0 }, now), true);
  const saved = await call('POST', '/api/duty-status/options', { token: t.owner, body: { ...t.savedOptions, autoClearHours: 99 } });
  assert.equal(saved.data.autoClearHours, 24, 'at most a day');
  await call('POST', '/api/duty-status/options', { token: t.owner, body: t.savedOptions });
  assert.equal((await summary(t.colleague.tok)).data.cards[t.res.name].st.s, 'or', 'a new status shows');
});

test('contact request: the holder is notified, lists it, and marks it done', async () => {
  const req = await call('POST', '/api/contact-requests', { token: t.colleague.tok, body: card() });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.equal(req.data.notified, 1);
  assert.equal((await call('POST', '/api/contact-requests', { token: t.colleague.tok, body: card() })).data.already, true, 'one open request per colleague');
  assert.equal((await call('POST', '/api/contact-requests', { token: t.holder.tok, body: card() })).data.error, 'own_card');
  const n = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items.find(x => x.type === 'contact_request');
  assert.ok(n && n.data.count === 1);
  // The holder sees the waiting count on their own card (the colleague does not).
  assert.equal((await summary(t.holder.tok)).data.cards[t.res.name].st.w, 1);
  assert.equal((await summary(t.colleague.tok)).data.cards[t.res.name].st.w, undefined);
  const list = (await call('GET', '/api/contact-requests', { token: t.holder.tok })).data;
  assert.equal(list.pending.length, 1);
  assert.equal(list.pending[0].byPhone.replace(/\D/g, '').slice(-10), t.col.phone.replace(/\D/g, '').slice(-10), 'the colleague\'s phone for the contact buttons');
  assert.equal((await call('POST', '/api/contact-requests/done', { token: t.colleague.tok, body: { id: list.pending[0].id } })).status, 404, 'only the holder');
  assert.equal((await call('POST', '/api/contact-requests/done', { token: t.holder.tok, body: { id: list.pending[0].id } })).data.ok, true);
  const after = (await call('GET', '/api/contact-requests', { token: t.holder.tok })).data;
  assert.equal(after.pending.length, 0);
  assert.equal(after.past[0].status, 'done');
});

test('status cleared', async () => {
  assert.equal((await call('POST', '/api/duty-status', { token: t.holder.tok, body: { ...card(), status: '' } })).data.status, null);
  assert.equal((await summary(t.colleague.tok)).data.cards[t.res.name].st, undefined);
});

test('cleanup', async () => {
  if (t.savedOptions) await call('POST', '/api/duty-status/options', { token: t.owner, body: t.savedOptions });
  const all = await rows(t.owner);
  const s = all.find(r => r[0] === 'sched' && r[1] === t.sched);
  if (s) await call('POST', '/api/sync', { token: t.owner, body: { msg: 'oncall test cleanup', ops: [{ c: 'sched', id: s[1], bv: s[4], del: 1 }] } });
  for (const a of [t.holder, t.colleague]) if (a) await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: a.id, action: 'delete' } });
});
