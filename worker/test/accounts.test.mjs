// End-to-end tests for personal accounts, approvals, password resets, notifications, likes and
// comments, against a running Worker seeded with worker/.local/import.sql + migrations/0002_accounts.sql.
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

// Same derivation as hub-accounts.js in the browser.
async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}

// Two real residents of the same hospital with a valid phone and a two-part name.
const hospital = HOSPITALS.find(h => SOURCE.residents.filter(r => (r.hospitals || []).includes(h.id) && /^\+?9647\d{9}$/.test(r.phone || '')).length >= 3);
const pool = SOURCE.residents.filter(r => (r.hospitals || []).includes(hospital.id) && /^\+?9647\d{9}$/.test(r.phone || '')
  && r.name.replace(/^د\.?\s*/, '').trim().split(/\s+/).length >= 2);
const phones = new Map();
for (const r of SOURCE.residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
const [resA, resB] = pool.filter(r => phones.get(r.phone) === 1);
const localPhone = p => '0' + p.replace(/\D/g, '').slice(-10);

const uA = `alpha_${RUN}`, uB = `beta_${RUN}`;
const state = {};
const legacy = async role => (await call('POST', '/api/login', { body: { password: PW[role] } })).data.token;
const accountLogin = async (username, password) => (await call('POST', '/api/accounts/login', { body: { username, key: await deriveKey(username, password) } })).data;
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

test('setup', async () => {
  assert.ok(resA && resB, 'two residents found in the snapshot');
  state.owner = await legacy('owner');
  state.admin = await legacy('admin');
  state.user = await legacy('user');
  assert.ok(state.owner && state.admin && state.user);
});

test('identity check matches name + phone of the chosen hospital only', async () => {
  const check = body => call('POST', '/api/accounts/check', { body });
  const wrongPhone = await check({ hosp: hospital.id, name: resA.name, phone: '07000000000' });
  assert.equal(wrongPhone.data.match, false);
  const wrongName = await check({ hosp: hospital.id, name: 'فلان الفلاني', phone: resA.phone });
  assert.equal(wrongName.data.match, false);
  const otherHospital = HOSPITALS.find(h => h.id !== hospital.id && !(resA.hospitals || []).includes(h.id));
  if (otherHospital) {
    const wrongHosp = await check({ hosp: otherHospital.id, name: resA.name, phone: resA.phone });
    assert.equal(wrongHosp.data.match, false);
  }
  // Spelling variants: no title, local phone format, hamza / ta marbuta differences.
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

test('sign-up creates pending accounts; one account per resident', async () => {
  const a = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: resA.name, phone: resA.phone, username: uA, key: await deriveKey(uA, 'pass-A-1') } });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.status, 'pending');
  const b = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: resB.name, phone: localPhone(resB.phone), username: uB, key: await deriveKey(uB, 'pass-B-1') } });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  const dupResident = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: resA.name, phone: resA.phone, username: uA + 'x', key: await deriveKey(uA + 'x', 'p') } });
  assert.equal(dupResident.data.error, 'already_registered');
  const dupUser = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: resA.name, phone: resA.phone, username: uA, key: await deriveKey(uA, 'p') } });
  assert.equal(dupUser.status, 409);
  const noMatch = await call('POST', '/api/accounts/signup', { body: { hosp: hospital.id, name: 'فلان الفلاني', phone: '07000000001', username: 'nobody_' + RUN, key: await deriveKey('nobody_' + RUN, 'p') } });
  assert.equal(noMatch.data.error, 'no_match');
});

test('pending accounts cannot sign in', async () => {
  const r = await accountLogin(uA, 'pass-A-1');
  assert.equal(r.success, false);
  assert.equal(r.status, 'pending');
});

test('approvers see pending requests; plain users do not', async () => {
  assert.equal((await call('GET', '/api/accounts?filter=pending', { token: state.user })).status, 403);
  const list = await call('GET', '/api/accounts?filter=pending', { token: state.admin });
  const mine = list.data.accounts.filter(a => [uA, uB].includes(a.username));
  assert.equal(mine.length, 2);
  assert.ok(!('pw' in mine[0]) && !('salt' in mine[0]));
  state.idA = mine.find(a => a.username === uA).id;
  state.idB = mine.find(a => a.username === uB).id;
  const n = await call('GET', '/api/notifications', { token: state.admin });
  assert.ok(n.data.pending.accounts >= 2);
});

test('admin approves, owner promotes; tokens follow the database', async () => {
  const approveA = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idA, action: 'approve' } });
  assert.equal(approveA.data.account.status, 'active');
  const approveB = await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.idB, action: 'approve' } });
  assert.equal(approveB.data.account.status, 'active');
  // Admins cannot hand out roles.
  const adminPromote = await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.idB, action: 'set_role', role: 'admin' } });
  assert.equal(adminPromote.status, 403);

  const a = await accountLogin(uA, 'pass-A-1');
  assert.equal(a.success, true, JSON.stringify(a));
  assert.equal(a.role, 'user');
  state.tokA = a.token;
  state.tokB = (await accountLogin(uB, 'pass-B-1')).token;
  assert.ok(state.tokB);
  assert.equal((await accountLogin(uA, 'wrong')).success, false);

  // The account sees full data (phones) like any signed-in role.
  const db = await call('GET', '/api/db?after=0', { token: state.tokA });
  assert.equal(db.data.full, true);

  const promote = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.idA, action: 'set_role', role: 'admin', hospitals: [hospital.id] } });
  assert.equal(promote.data.account.role, 'admin');
  const me = await call('GET', '/api/accounts/me', { token: state.tokA });
  assert.equal(me.data.role, 'admin');
  assert.deepEqual(me.data.adminHospitals, [hospital.id]);
  const notes = await call('GET', '/api/notifications', { token: state.tokA });
  assert.ok(notes.data.items.some(n => n.type === 'account_approved'));
  assert.ok(notes.data.items.some(n => n.type === 'role_changed'));
  // A promoted account cannot be managed by another hospital admin.
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.idA, action: 'disable' } })).status, 403);
});

test('likes notify the resident of the card, grouped', async () => {
  const card = { h: hospital.id, d: today(), n: resB.name };
  const on = await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: true } });
  assert.deepEqual(on.data, { ok: true, likes: 1, mine: true });
  const twice = await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: true } });
  assert.equal(twice.data.likes, 1);
  // Guests cannot react.
  assert.equal((await call('POST', '/api/social/like', { body: card })).status, 401);
  // Shared-password sessions have no identity to like with.
  assert.equal((await call('POST', '/api/social/like', { token: state.user, body: card })).status, 403);

  const q = new URLSearchParams({ h: card.h, d: card.d });
  q.append('n', resB.name);
  q.append('n', 'الدكتور ' + resB.name.replace(/^د\.?\s*/, '')); // same person, other spelling -> same card
  const summary = await call('GET', '/api/social?' + q, { token: state.tokB });
  const values = Object.values(summary.data.cards);
  assert.equal(values.length, 2);
  for (const v of values) assert.equal(v.likes, 1);

  const notes = await call('GET', '/api/notifications', { token: state.tokB });
  const likeNote = notes.data.items.find(n => n.type === 'like');
  assert.ok(likeNote, 'B notified');
  assert.equal(likeNote.data.count, 1);
  assert.equal(likeNote.data.last, resA.name);
  assert.ok(notes.data.unread >= 1);

  const off = await call('POST', '/api/social/like', { token: state.tokA, body: { ...card, on: false } });
  assert.deepEqual(off.data, { ok: true, likes: 0, mine: false });
});

test('comments: real name or a stable anonymous tag; only the owner can unmask', async () => {
  const card = { h: hospital.id, d: today(), n: resB.name };
  const named = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, body: 'شكراً <b>دكتور</b>' } });
  assert.equal(named.data.comment.author, resA.name);
  assert.equal(named.data.comment.body, 'شكراً bدكتور/b');
  const anon1 = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, body: 'تعليق مجهول', anon: true } });
  const anon2 = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, body: 'ثاني', anon: true } });
  assert.match(anon1.data.comment.author, /^مجهول · /);
  assert.equal(anon1.data.comment.author, anon2.data.comment.author, 'same tag within one card');
  const otherCard = await call('POST', '/api/social/comment', { token: state.tokA, body: { ...card, d: '01/01/2026', body: 'x', anon: true } });
  assert.ok(otherCard.data.comment.author.startsWith('مجهول'));

  const seenByB = await call('GET', '/api/social/thread?' + new URLSearchParams(card), { token: state.tokB });
  assert.equal(seenByB.data.comments.length, 3);
  const anonForB = seenByB.data.comments.find(c => c.anon);
  assert.equal(anonForB.realName, undefined);
  assert.equal(anonForB.canDelete, false);
  const seenByOwner = await call('GET', '/api/social/thread?' + new URLSearchParams(card), { token: state.owner });
  assert.equal(seenByOwner.data.comments.find(c => c.anon).realName, resA.name);

  const notes = await call('GET', '/api/notifications', { token: state.tokB });
  const c = notes.data.items.find(n => n.type === 'comment' && n.data.d !== '2026-01-01');
  assert.equal(c.data.count, 3);
  assert.match(c.data.last, /^مجهول/);

  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokB, body: { cid: anon1.data.comment.cid } })).status, 403);
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.tokA, body: { cid: anon1.data.comment.cid } })).data.ok, true);
  assert.equal((await call('POST', '/api/social/comment/delete', { token: state.admin, body: { cid: anon2.data.comment.cid } })).data.ok, true);

  const seen = await call('POST', '/api/notifications/seen', { token: state.tokB, body: {} });
  assert.equal(seen.data.ok, true);
  assert.equal((await call('GET', '/api/notifications', { token: state.tokB })).data.unread, 0);
});

test('forgotten password: request -> approval -> new password; old sessions end', async () => {
  const phone = localPhone(resB.phone);
  // Unknown users get the same answer.
  assert.deepEqual((await call('POST', '/api/accounts/forgot', { body: { username: 'nobody_' + RUN, phone } })).data, { ok: true });
  assert.deepEqual((await call('POST', '/api/accounts/forgot', { body: { username: uB, phone } })).data, { ok: true });
  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone } })).data.state, 'requested');
  const early = await call('POST', '/api/accounts/reset', { body: { username: uB, phone, key: await deriveKey(uB, 'pass-B-2') } });
  assert.equal(early.status, 403);

  // A is now admin of the hospital and is notified of the request.
  const notesA = await call('GET', '/api/notifications', { token: state.tokA });
  assert.ok(notesA.data.items.some(n => n.type === 'reset_request'));
  assert.ok(notesA.data.pending.resets >= 1);
  const resets = await call('GET', '/api/accounts?filter=resets', { token: state.tokA });
  assert.ok(resets.data.accounts.some(a => a.id === state.idB));
  const approve = await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'approve_reset' } });
  assert.equal(approve.data.account.reset, 'approved');

  assert.equal((await call('POST', '/api/accounts/reset', { body: { username: uB, phone } })).data.state, 'approved');
  const done = await call('POST', '/api/accounts/reset', { body: { username: uB, phone, key: await deriveKey(uB, 'pass-B-2') } });
  assert.equal(done.data.state, 'done');
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).status, 401, 'old token revoked');
  assert.equal((await accountLogin(uB, 'pass-B-1')).success, false);
  const fresh = await accountLogin(uB, 'pass-B-2');
  assert.equal(fresh.success, true);
  state.tokB = fresh.token;
});

test('change own password; disable signs the account out', async () => {
  const change = await call('POST', '/api/accounts/password', { token: state.tokB, body: { oldKey: await deriveKey(uB, 'pass-B-2'), newKey: await deriveKey(uB, 'pass-B-3') } });
  assert.equal(change.data.ok, true);
  assert.equal((await call('GET', '/api/accounts/me', { token: state.tokB })).status, 401);
  assert.equal((await call('GET', '/api/accounts/me', { token: change.data.token })).status, 200);
  const wrongOld = await call('POST', '/api/accounts/password', { token: change.data.token, body: { oldKey: await deriveKey(uB, 'nope'), newKey: await deriveKey(uB, 'x') } });
  assert.equal(wrongOld.status, 403);

  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'disable' } });
  assert.equal((await call('GET', '/api/accounts/me', { token: change.data.token })).status, 401);
  assert.equal((await accountLogin(uB, 'pass-B-3')).success, false);
  await call('POST', '/api/accounts/decide', { token: state.tokA, body: { id: state.idB, action: 'enable' } });
  const again = await accountLogin(uB, 'pass-B-3');
  assert.equal(again.success, true);
  state.tokB = again.token;
});

test('account users can still sign up for duties (same permission rules)', async () => {
  const resident = await call('POST', '/api/sync', { token: state.tokB, body: { msg: 't', ops: [{ c: 'resident', id: resB.id, d: { x: 1 }, bv: 1 }] } });
  assert.deepEqual(resident.data.rejected, [0], 'plain user cannot edit residents');
});

test('cleanup: owner deletes the test accounts', async () => {
  for (const id of [state.idA, state.idB]) {
    const r = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id, action: 'delete' } });
    assert.equal(r.data.ok, true);
  }
});
