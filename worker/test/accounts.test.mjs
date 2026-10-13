// End-to-end tests for personal accounts, approvals, devices, settings, password resets,
// notifications, push subscriptions, likes and comments, against a running Worker seeded with
// worker/.local/import.sql + migrations/0002_accounts.sql.
// Run: API_BASE=http://127.0.0.1:8790 node --test --test-concurrency=1 worker/test/accounts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA_FILE = process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json');
const SOURCE = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const HOSPITALS = Object.values(SOURCE.hospitals);
const PW = SOURCE.globalPasswords;
const RUN = Date.now().toString(36).slice(-5);

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// Same derivation as hub-core.js in the browser.
async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}

// Residents of the same hospital with a unique valid phone and a two-part name.
const hospital = HOSPITALS.find(h => SOURCE.residents.filter(r => (r.hospitals || []).includes(h.id) && /^\+?9647\d{9}$/.test(r.phone || '')).length >= 3);
const otherHospital = HOSPITALS.find(h => h.id !== hospital.id);
const phones = new Map();
for (const r of SOURCE.residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
const pool = SOURCE.residents.filter(r => (r.hospitals || []).includes(hospital.id) && /^\+?9647\d{9}$/.test(r.phone || '')
  && phones.get(r.phone) === 1 && r.name.replace(/^د\.?\s*/, '').trim().split(/\s+/).length >= 2);
const [resA, resB, resC] = pool;
const localPhone = p => '0' + p.replace(/\D/g, '').slice(-10);

const uA = `alpha_${RUN}`, uB = `beta_${RUN}`, uC = `gamma_${RUN}`;
const DEV = { a1: 'deviceA1-' + RUN + 'xxxxxxxx', b1: 'deviceB1-' + RUN + 'xxxxxxxx', b2: 'deviceB2-' + RUN + 'xxxxxxxx', b3: 'deviceB3-' + RUN + 'xxxxxxxx', c1: 'deviceC1-' + RUN + 'xxxxxxxx' };
const state = {};
const legacy = async role => (await call('POST', '/api/login', { body: { password: PW[role] } })).data.token;
const accountLogin = async (username, password, deviceId) => (await call('POST', '/api/accounts/login', {
  body: { username, key: await deriveKey(username, password), deviceId, deviceLabel: 'Test ' + deviceId.slice(0, 8) },
})).data;
const signup = async (res, username, password, sex, extra = {}) => call('POST', '/api/accounts/signup', {
  body: { hosp: hospital.id, name: res.name, phone: res.phone, username, key: await deriveKey(username, password), sex, ...extra },
});
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

test('setup', async () => {
  assert.ok(resA && resB && resC, 'three residents found in the snapshot');
  state.owner = await legacy('owner');
  state.admin = await legacy('admin');
  state.user = await legacy('user');
  assert.ok(state.owner && state.admin && state.user);
});

test('identity check matches name + phone of the chosen hospital only', async () => {
  const check = body => call('POST', '/api/accounts/check', { body });
  assert.equal((await check({ hosp: hospital.id, name: resA.name, phone: '07000000000' })).data.match, false);
  assert.equal((await check({ hosp: hospital.id, name: 'فلان الفلاني', phone: resA.phone })).data.match, false);
  const elsewhere = HOSPITALS.find(h => !(resA.hospitals || []).includes(h.id));
  if (elsewhere) assert.equal((await check({ hosp: elsewhere.id, name: resA.name, phone: resA.phone })).data.match, false);
  const variant = resA.name.replace(/^د\.?\s*/, '').replace(/أ|إ/g, 'ا').replace(/ة/g, 'ه');
  const ok = await check({ hosp: hospital.id, name: variant, phone: localPhone(resA.phone) });
  assert.equal(ok.data.match, true);
  assert.equal(ok.data.taken, false);
  assert.equal(ok.data.name, resA.name);
});

test('username availability', async () => {
  assert.deepEqual((await call('GET', '/api/accounts/username?u=ab')).data, { ok: true, valid: false, free: false });
  assert.equal((await call('GET', `/api/accounts/username?u=${uA}`)).data.free, true);
});

test('sign-up requires male/female and creates pending accounts; one account per resident', async () => {
  assert.equal((await signup(resA, uA, 'pass-A-1', undefined)).data.error, 'bad_sex');
  assert.equal((await signup(resA, uA, 'pass-A-1', 'x')).data.error, 'bad_sex');
  const a = await signup(resA, uA, 'pass-A-1', 'm');
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.status, 'pending');
  const b = await signup(resB, uB, 'pass-B-1', 'f', { lang: 'en' });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  const c = await signup(resC, uC, 'pass-C-1', 'f');
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal((await signup(resA, uA + 'x', 'p', 'm')).data.error, 'already_registered');
  assert.equal((await signup(resA, uA, 'p', 'm')).status, 409);
  const noMatch = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: 'فلان الفلاني', phone: '07000000001', username: 'nobody_' + RUN, key: await deriveKey('nobody_' + RUN, 'p'), sex: 'm' } });
  assert.equal(noMatch.data.error, 'no_match');
});

test('pending accounts cannot sign in', async () => {
  const r = await accountLogin(uA, 'pass-A-1', DEV.a1);
  assert.equal(r.success, false);
  assert.equal(r.status, 'pending');
});

test('owner sees every request; plain users see none', async () => {
  assert.equal((await call('GET', '/api/accounts?filter=pending', { token: state.user })).status, 403);
  const list = await call('GET', '/api/accounts?filter=pending', { token: state.owner });
  const mine = list.data.accounts.filter(a => [uA, uB, uC].includes(a.username));
  assert.equal(mine.length, 3);
  assert.ok(!('pw' in mine[0]) && !('salt' in mine[0]) && !('anon_key' in mine[0]));
  for (const a of mine) state[a.username] = a;
  state.idA = state[uA].id; state.idB = state[uB].id; state.idC = state[uC].id;
  assert.equal(state[uA].sex, 'm');
  assert.equal(state[uB].sex, 'f');
  // Reddit-style nicknames, by sex and language.
  assert.match(state[uB].anon_tag, /^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/, 'English nickname for B');
  assert.match(state[uA].anon_tag, /^[؀-ۿ]+-[؀-ۿ]+-\d{4}$/, 'Arabic nickname for A');
  const n = await call('GET', '/api/notifications', { token: state.owner });
  assert.ok(n.data.pending.accounts >= 3);
});

test('approvals; only the owner changes roles; tokens follow the database', async () => {
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idA, action: 'approve' } })).data.account.status, 'active');
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.idB, action: 'approve' } })).data.account.status, 'active');
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idC, action: 'approve' } })).data.account.status, 'active');
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.idB, action: 'set_role', role: 'admin' } })).status, 403);

  const a = await accountLogin(uA, 'pass-A-1', DEV.a1);
  assert.equal(a.success, true, JSON.stringify(a));
  state.tokA = a.token;
  state.tokB = (await accountLogin(uB, 'pass-B-1', DEV.b1)).token;
  state.tokC = (await accountLogin(uC, 'pass-C-1', DEV.c1)).token;
  assert.ok(state.tokB && state.tokC);
  assert.equal((await accountLogin(uA, 'wrong', DEV.a1)).success, false);
  assert.equal((await call('POST', '/api/accounts/login', { body: { username: uA, key: await deriveKey(uA, 'pass-A-1') } })).data.error, 'bad_device');

  assert.equal((await call('GET', '/api/db?after=0', { token: state.tokA })).data.full, true);

  const promote = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idA, action: 'set_role', role: 'admin', hospitals: [hospital.id] } });
  assert.equal(promote.data.account.role, 'admin');
  const me = await call('GET', '/api/accounts/me', { token: state.tokA });
  assert.equal(me.data.role, 'admin');
  assert.deepEqual(me.data.adminHospitals, [hospital.id]);
  assert.equal(me.data.account.devices.length, 1);
  const notes = await call('GET', '/api/notifications', { token: state.tokA });
  assert.ok(notes.data.items.some(n => n.type === 'account_approved'));
  assert.ok(notes.data.items.some(n => n.type === 'role_changed'));

  // A hospital admin only sees and manages its own hospital's plain users.
  const scoped = await call('GET', '/api/accounts?filter=all', { token: state.tokA });
  assert.ok(scoped.data.accounts.every(x => x.hosp === hospital.id));
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idA, action: 'disable' } })).status, 403, 'not on itself');
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'set_role', role: 'admin' } })).status, 403);
  // ...and the owner can switch a user back to a regular user.
  const demote = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idC, action: 'set_role', role: 'admin', hospitals: [hospital.id] } });
  assert.equal(demote.data.account.role, 'admin');
  const back = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idC, action: 'set_role', role: 'user' } });
  assert.equal(back.data.account.role, 'user');
  assert.deepEqual(back.data.account.hospitals, []);
});

test('device limit: single device, a set number, unlimited; removing a device signs it out', async () => {
  const one = await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'set_devices', maxDevices: 1 } });
  assert.equal(one.data.account.max_devices, 1);
  const blocked = await accountLogin(uB, 'pass-B-1', DEV.b2);
  assert.equal(blocked.success, false);
  assert.equal(blocked.status, 'device_limit');
  assert.equal((await accountLogin(uB, 'pass-B-1', DEV.b1)).success, true, 'the registered device still works');

  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'set_devices', maxDevices: 2 } });
  const second = await accountLogin(uB, 'pass-B-1', DEV.b2);
  assert.equal(second.success, true);
  assert.equal((await accountLogin(uB, 'pass-B-1', DEV.b3)).status, 'device_limit');

  // The admin unlinks device 2: its token stops working at once.
  const rm = await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'remove_device', deviceId: DEV.b2 } });
  assert.equal(rm.data.account.devices.length, 1);
  assert.equal((await call('GET', '/api/accounts/me', { token: second.token })).status, 401);
  assert.equal((await accountLogin(uB, 'pass-B-1', DEV.b3)).success, true);

  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'set_devices', maxDevices: 0 } });
  const reset = await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'reset_devices' } });
  assert.equal(reset.data.account.devices.length, 0);
  assert.equal(reset.data.account.max_devices, 0);
  const fresh = await accountLogin(uB, 'pass-B-1', DEV.b1);
  assert.equal(fresh.success, true);
  state.tokB = fresh.token;

  // A user can unlink their own device.
  const meB = await call('GET', '/api/accounts/me', { token: state.tokB });
  assert.equal(meB.data.device, DEV.b1);
  const self = await call('POST', '/api/accounts/devices/remove', { token: state.tokB, body: { deviceId: DEV.b1 } });
  assert.equal(self.data.self, true);
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).status, 401);
  state.tokB = (await accountLogin(uB, 'pass-B-1', DEV.b1)).token;
});

test('settings: random or custom nickname, duplicate-checked, language switch', async () => {
  const before = (await call('GET', '/api/accounts/me', { token: state.tokA })).data.account.anon_tag;
  const random = await call('POST', '/api/accounts/anon', { token: state.tokA, body: { mode: 'random' } });
  assert.notEqual(random.data.anon_tag, before);
  const en = await call('POST', '/api/accounts/anon', { token: state.tokA, body: { lang: 'en' } });
  assert.equal(en.data.anon_lang, 'en');
  assert.match(en.data.anon_tag, /^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
  // English male nouns never use the female list.
  assert.doesNotMatch(en.data.anon_tag, /-(Lioness|Gazelle|Queen|Princess|Duchess)-/);

  const custom = 'Night_Owl_' + RUN;
  assert.equal((await call('GET', '/api/accounts/anon-check?tag=' + encodeURIComponent(custom), { token: state.tokB })).data.free, true);
  assert.equal((await call('POST', '/api/accounts/anon', { token: state.tokA, body: { mode: 'custom', tag: custom } })).data.anon_tag, custom);
  // Same nickname with other case / separators counts as a duplicate.
  const dupVariant = custom.toUpperCase().replace(/_/g, '-');
  assert.equal((await call('GET', '/api/accounts/anon-check?tag=' + encodeURIComponent(dupVariant), { token: state.tokB })).data.free, false);
  assert.equal((await call('POST', '/api/accounts/anon', { token: state.tokB, body: { mode: 'custom', tag: dupVariant } })).data.error, 'nick_taken');
  assert.equal((await call('GET', '/api/accounts/anon-check?tag=' + encodeURIComponent(custom), { token: state.tokA })).data.mine, true);
  assert.equal((await call('POST', '/api/accounts/anon', { token: state.tokB, body: { mode: 'custom', tag: 'ab' } })).data.error, 'nick_invalid');
  assert.equal((await call('POST', '/api/accounts/anon', { token: state.tokB, body: { mode: 'custom', tag: 'Admin-' + RUN } })).data.error, 'nick_reserved');
  assert.equal((await call('POST', '/api/accounts/anon', { token: state.tokB, body: { mode: 'custom', tag: 'د-ماهر-' + RUN } })).data.error, 'nick_reserved');
  state.nickA = custom;
});

test('likes notify the resident of the card, grouped', async () => {
  const card = { h: hospital.id, d: today(), n: resB.name };
  assert.deepEqual((await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: true } })).data, { ok: true, likes: 1, mine: true });
  assert.equal((await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: true } })).data.likes, 1);
  assert.equal((await call('POST', '/api/social/like', { body: card })).status, 401);
  assert.equal((await call('POST', '/api/social/like', { token: state.user, body: card })).status, 403);

  const q = new URLSearchParams({ h: card.h, d: card.d });
  q.append('n', resB.name);
  q.append('n', 'الدكتور ' + resB.name.replace(/^د\.?\s*/, ''));
  const values = Object.values((await call('GET', '/api/social?' + q, { token: state.tokB })).data.cards);
  assert.equal(values.length, 2);
  for (const v of values) assert.equal(v.likes, 1);

  const likeNote = (await call('GET', '/api/notifications', { token: state.tokB })).data.items.find(n => n.type === 'like');
  assert.ok(likeNote, 'B notified');
  assert.equal(likeNote.data.count, 1);
  assert.equal(likeNote.data.last, resA.name);
  assert.deepEqual((await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: false } })).data, { ok: true, likes: 0, mine: false });
});

test('comments: anonymous ones show the account nickname to everyone; moderation by scope', async () => {
  const card = { h: hospital.id, d: today(), n: resB.name };
  const named = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, body: 'شكراً <b>دكتور</b>' } });
  assert.equal(named.data.comment.author, resA.name);
  assert.equal(named.data.comment.body, 'شكراً bدكتور/b');
  const anon1 = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, body: 'تعليق مجهول', anon: true } });
  assert.equal(anon1.data.comment.author, state.nickA, 'the account nickname');
  const otherCard = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, d: '01/01/2026', body: 'x', anon: true } });
  assert.equal(otherCard.data.comment.author, state.nickA, 'same nickname on every card');
  const byC = await call('POST', '/api/social/comment', { token: state.tokC, body: { ...card, body: 'من C', anon: true } });

  const seenByB = await call('GET', '/api/social/thread?' + new URLSearchParams(card), { token: state.tokB });
  assert.equal(seenByB.data.comments.length, 3);
  const anonForB = seenByB.data.comments.find(c => c.cid === anon1.data.comment.cid);
  assert.equal(anonForB.author, state.nickA);
  assert.equal(anonForB.realName, undefined);
  assert.equal(anonForB.canDelete, false);
  // Shared-password users see them too.
  assert.equal((await call('GET', '/api/social/thread?' + new URLSearchParams(card), { token: state.user })).data.comments.length, 3);
  const seenByOwner = await call('GET', '/api/social/thread?' + new URLSearchParams(card), { token: state.owner });
  assert.equal(seenByOwner.data.comments.find(c => c.cid === anon1.data.comment.cid).realName, resA.name);
  assert.ok(seenByOwner.data.comments.every(c => c.canDelete));

  const c = (await call('GET', '/api/notifications', { token: state.tokB })).data.items.find(n => n.type === 'comment' && n.data.d !== '2026-01-01');
  assert.equal(c.data.count, 3);

  // Moderation feed: owner everywhere, a hospital admin only in its hospital.
  const ownerFeed = await call('GET', '/api/social/recent', { token: state.owner });
  assert.ok(ownerFeed.data.comments.some(x => x.cid === byC.data.comment.cid));
  const adminFeed = await call('GET', '/api/social/recent', { token: state.tokA });
  assert.ok(adminFeed.data.comments.every(x => x.hosp === hospital.id));
  assert.equal((await call('GET', '/api/social/recent', { token: state.tokB })).status, 403);

  // A comment on another hospital's card: the hospital admin A may not delete it, the owner may.
  const foreign = await call('POST', '/api/social/comment', { token: state.tokC, body: { h: otherHospital.id, d: today(), n: resB.name, body: 'في مستشفى آخر' } });
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokA, body: { cid: foreign.data.comment.cid } })).status, 403);
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.owner, body: { cid: foreign.data.comment.cid } })).data.ok, true);
  // In its own hospital the admin can remove anyone's comment; the author can remove their own.
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokB, body: { cid: byC.data.comment.cid } })).status, 403);
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokA, body: { cid: byC.data.comment.cid } })).data.ok, true);
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokA, body: { cid: anon1.data.comment.cid } })).data.ok, true);

  assert.equal((await call('POST', '/api/notifications/seen', { token: state.tokB, body: {} })).data.ok, true);
  assert.equal((await call('GET', '/api/notifications', { token: state.tokB })).data.unread, 0);
});

test('push: public key, subscription validation, one subscription per device', async () => {
  const key = await call('GET', '/api/push/key');
  assert.match(key.data.key, /^B[A-Za-z0-9_-]{86}$/);
  const keys = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.tokB, body: { subscription: { endpoint: 'https://evil.example.com/x', keys } } })).data.error, 'bad_subscription');
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.user, body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys } } })).status, 403);
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.tokB, body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/one-' + RUN, keys } } })).data.ok, true);
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.tokB, body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/two-' + RUN, keys } } })).data.ok, true);
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).data.account.push_devices, 1);
  assert.equal((await call('POST', '/api/push/unsubscribe', { token: state.tokB, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/two-' + RUN } })).data.ok, true);
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).data.account.push_devices, 0);
});

test('forgotten password: request -> approval -> new password; old sessions end', async () => {
  const phone = localPhone(resB.phone);
  assert.deepEqual((await call('POST', '/api/accounts/forgot', { body: { username: 'nobody_' + RUN, phone } })).data, { ok: true });
  assert.deepEqual((await call('POST', '/api/accounts/forgot', { body: { username: uB, phone } })).data, { ok: true });
  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone } })).data.state, 'requested');
  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone, key: await deriveKey(uB, 'pass-B-2') } })).status, 403);

  const notesA = await call('GET', '/api/notifications', { token: state.tokA });
  assert.ok(notesA.data.items.some(n => n.type === 'reset_request'));
  assert.ok(notesA.data.pending.resets >= 1);
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'approve_reset' } })).data.account.reset, 'approved');
  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone } })).data.state, 'approved');
  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone, key: await deriveKey(uB, 'pass-B-2') } })).data.state, 'done');
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).status, 401, 'old token revoked');
  assert.equal((await accountLogin(uB, 'pass-B-1', DEV.b1)).success, false);
  const fresh = await accountLogin(uB, 'pass-B-2', DEV.b1);
  assert.equal(fresh.success, true);
  state.tokB = fresh.token;
});

test('change own password; disable signs the account out', async () => {
  const change = await call('POST', '/api/accounts/password', { token: state.tokB, body: { oldKey: await deriveKey(uB, 'pass-B-2'), newKey: await deriveKey(uB, 'pass-B-3') } });
  assert.equal(change.data.ok, true);
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).status, 401);
  assert.equal((await call('GET', '/api/accounts/me', { token: change.data.token })).status, 200);
  assert.equal((await call('POST', '/api/accounts/password', { token: change.data.token, body: { oldKey: await deriveKey(uB, 'nope'), newKey: await deriveKey(uB, 'x') } })).status, 403);

  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'disable' } });
  assert.equal((await call('GET', '/api/accounts/me', { token: change.data.token })).status, 401);
  assert.equal((await accountLogin(uB, 'pass-B-3', DEV.b1)).success, false);
  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'enable' } });
  const again = await accountLogin(uB, 'pass-B-3', DEV.b1);
  assert.equal(again.success, true);
  state.tokB = again.token;
});

test('account users keep the same duty permissions', async () => {
  const r = await call('POST', '/api/sync', { token: state.tokB, body: { msg: 't', ops: [{ c: 'resident', id: resB.id, d: { x: 1 }, bv: 1 }] } });
  assert.deepEqual(r.data.rejected, [0], 'plain user cannot edit residents');
});

test('cleanup: owner deletes the test accounts', async () => {
  for (const id of [state.idA, state.idB, state.idC]) {
    assert.equal((await call('POST', '/api/accounts/decide', { token: state.owner, body: { id, action: 'delete' } })).data.ok, true);
  }
});
