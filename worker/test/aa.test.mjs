// End-to-end tests for the Administrative Affairs division (aa.js) and the officer / rotator
// account rules, against a running Worker seeded like accounts.test.mjs plus migrations 0002-0008.
// Run: API_BASE=http://127.0.0.1:8790 node --test --test-concurrency=1 worker/test/aa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dutyDayNow } from '../src/profile.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const SOURCE = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));
const PW = SOURCE.globalPasswords;
const RUN = Date.now().toString(36).slice(-5);
const [H, X] = Object.keys(SOURCE.hospitals);
const MIRROR = 'aa__' + H;

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
async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}
const legacy = async role => (await call('POST', '/api/login', { body: { password: PW[role] } })).data.token;
const login = async (username, deviceId) => (await call('POST', '/api/accounts/login', {
  body: { username, key: await deriveKey(username, 'Pass-1234'), deviceId: deviceId + '-' + RUN + 'xxxxxxxxxx', deviceLabel: 'Test' },
})).data;
const today = () => dutyDayNow().split('-').reverse().join('/');
const rowsOf = res => res.data.rows.map(([c, id, h, o, v, d]) => ({ c, id, h, o, v, d }));

const JOB_AO = 'AO' + RUN.slice(0, 2).toUpperCase(), JOB_SEC = 'SEC' + RUN.slice(0, 2).toUpperCase();
const OFFICER = { id: 'res-t' + RUN, name: 'أ. علي حسين جاسم', phone: '+9647' + String(Date.now()).slice(-9), spec: JOB_AO, tag: JOB_AO, dept: JOB_AO, department: JOB_AO, active: true, hospitals: [H] };
const GUARD = { id: 'res-g' + RUN, name: 'كريم عباس ناصر', phone: '+9647' + String(Date.now() + 7).slice(-9), spec: JOB_SEC, tag: JOB_SEC, dept: JOB_SEC, department: JOB_SEC, active: true, hospitals: [H] };
const NEW_PHONE = '07' + String(Date.now() + 13).slice(-9);
const U = { o1: `oa_${RUN}`, o2: `ob_${RUN}`, r: `ro_${RUN}` };
const state = { versions: {} };

/** Writes division rows with the versions this test last saw. */
async function aaSync(token, ops, hosp = H) {
  const res = await call('POST', `/api/aa/sync?h=${hosp}`, { token, body: { msg: 'aa test', ops: ops.map(o => ({ ...o, bv: o.bv ?? state.versions[o.c + '|' + o.id] ?? 0 })) } });
  for (const [i, v] of (res.data.applied || [])) state.versions[ops[i].c + '|' + ops[i].id] = v;
  return res.data;
}

test('setup', async () => {
  state.owner = await legacy('owner');
  state.admin = await legacy('admin');
  state.user = await legacy('user');
  assert.ok(state.owner && state.admin && state.user && H && X);
});

test('the division is private: only the owner, admins and its officers read it; never part of /api/db', async () => {
  assert.equal((await call('GET', `/api/aa/db?h=${H}`)).status, 401);
  assert.equal((await call('GET', `/api/aa/db?h=${H}`, { token: state.user })).status, 403);
  const res = await call('GET', `/api/aa/db?h=${H}`, { token: state.admin });
  assert.equal(res.status, 200);
  assert.equal(res.data.full, true);
  const rows = rowsOf(res);
  const hospRow = rows.find(r => r.c === 'hospital');
  assert.ok(hospRow, 'a division always has its hospital record');
  assert.equal(hospRow.id, H);
  assert.equal(hospRow.d.name_ar, SOURCE.hospitals[H].name_ar, 'display fields follow the hospital');
  for (const r of rows) state.versions[r.c + '|' + r.id] = r.v;
  state.hospital = hospRow.d;
  const main = await call('GET', '/api/db', { token: state.owner });
  assert.ok(!main.data.rows.some(r => String(r[1]).startsWith(H + ':') && r[0] === 'sched' && r[5] && r[5].specCode === JOB_AO));
});

test('division admins (here the hospital admin) add job titles, officers and duties', async () => {
  const jobs = [
    { id: JOB_AO, name_ar: 'المعاون الإداري ' + RUN, name_en: 'Administrative Officer', icon: '🧑‍💼', prefix: 'أ. ', color: '#475569', enabled: true },
    { id: JOB_SEC, name_ar: 'مسؤول الأمن ' + RUN, name_en: 'Head of Security', icon: '🛡️', prefix: '', color: '#b91c1c', enabled: true },
  ];
  state.hospital = { ...state.hospital, specialties: [...(state.hospital.specialties || []), ...jobs], names: [...(state.hospital.names || []), OFFICER, GUARD] };
  const res = await aaSync(state.admin, [
    { c: 'hospital', id: H, h: H, o: 0, d: state.hospital },
    { c: 'resident', id: OFFICER.id, h: null, o: 0, d: OFFICER },
    { c: 'resident', id: GUARD.id, h: null, o: 1, d: GUARD },
    { c: 'sched', id: `${H}:t1${RUN}`, h: H, o: 0, d: { date: today(), specCode: JOB_AO, name: OFFICER.name, dutyTime: '', dutySlot: 0, VisitCount: 0 } },
    { c: 'sched', id: `${H}:t2${RUN}`, h: H, o: 1, d: { date: today(), specCode: JOB_SEC, name: GUARD.name, dutyTime: '', dutySlot: 0, VisitCount: 0 } },
  ]);
  assert.equal(res.applied.length, 5, JSON.stringify(res));
  // A slot of another hospital, or an ICU record, is refused even for an admin.
  const bad = await aaSync(state.admin, [
    { c: 'sched', id: `${X}:bad${RUN}`, h: X, o: 0, d: { date: today(), specCode: JOB_AO, name: 'x' } },
    { c: 'icu', id: H, h: H, o: 0, d: {} },
    { c: 'hospital', id: X, h: X, o: 0, d: {} },
  ]);
  assert.deepEqual(bad.rejected, [0, 1, 2]);
  // The owner reaches every hospital's division.
  assert.equal((await call('GET', `/api/aa/db?h=${X}`, { token: state.owner })).status, 200);
});

test('job titles are public for the sign-up form; the identity check matches the division\'s officers', async () => {
  const jobs = (await call('GET', `/api/aa/jobs?h=${H}`)).data.jobs;
  assert.ok(jobs.some(j => j.id === JOB_AO && j.prefix === 'أ. '));
  assert.ok(jobs.some(j => j.id === JOB_SEC));
  const check = body => call('POST', '/api/aa/check', { body }).then(r => r.data);
  const ok = await check({ hosp: H, name: 'علي حسين', phone: '0' + OFFICER.phone.slice(-10) });
  assert.equal(ok.match, true);
  assert.equal(ok.name, OFFICER.name);
  assert.equal(ok.job, JOB_AO);
  assert.equal((await check({ hosp: H, name: 'علي حسين', phone: '07000000000' })).match, false);
  assert.equal((await check({ hosp: X, name: 'علي حسين', phone: OFFICER.phone })).match, false);
  // Officers are not residents: the doctors' identity check does not know them.
  assert.equal((await call('POST', '/api/accounts/check', { body: { hosp: H, name: OFFICER.name, phone: OFFICER.phone } })).data.match, false);
});

test('officer sign-up: verified and unverified requests, bad input refused', async () => {
  const signup = async (username, extra) => call('POST', '/api/accounts/signup-officer', {
    body: { hosp: H, username, key: await deriveKey(username, 'Pass-1234'), sex: 'm', ...extra },
  });
  assert.equal((await signup('zz' + RUN, { job: 'NOPE', name: 'علي حسين', phone: OFFICER.phone })).data.error, 'bad_job');
  assert.equal((await signup('zz' + RUN, { job: JOB_AO, name: 'علي حسين', phone: '123' })).data.error, 'bad_phone');
  const a = await signup(U.o1, { job: JOB_AO, name: 'علي حسين', phone: '0' + OFFICER.phone.slice(-10) });
  assert.equal(a.data.ok, true);
  assert.equal(a.data.verified, true);
  assert.equal(a.data.name, OFFICER.name);
  assert.equal((await signup('zy' + RUN, { job: JOB_AO, name: 'علي حسين', phone: OFFICER.phone })).data.error, 'already_registered');
  const b = await signup(U.o2, { job: JOB_SEC, name: 'حيدر كاظم مهدي', phone: NEW_PHONE });
  assert.equal(b.data.ok, true);
  assert.equal(b.data.verified, false);
  const pending = (await call('GET', '/api/accounts?filter=pending', { token: state.owner })).data.accounts;
  const o1 = pending.find(x => x.username === U.o1), o2 = pending.find(x => x.username === U.o2);
  assert.equal(o1.role, 'aa_user');
  assert.equal(o1.aa_job, JOB_AO);
  assert.ok(o1.resident_id);
  assert.equal(o2.resident_id, null);
  assert.equal(o2.aa_job_name, 'مسؤول الأمن ' + RUN);
  assert.ok(!('board' in o1) && !('profile_complete' in o1), 'officers have no resident profile');
  state.o1 = o1.id;
  state.o2 = o2.id;
  const notes = (await call('GET', '/api/notifications', { token: (await login('adm_mv7kjvs4', 'own')).token })).data;
  assert.ok(notes.pending.accounts >= 2);
});

test('approval: the hospital admin chooses division admin or user; an unverified officer joins the database', async () => {
  const decide = (token, body) => call('POST', '/api/accounts/decide', { token, body });
  const hospAdmin = await legacy('admin');
  assert.equal((await decide(hospAdmin, { id: state.o1, action: 'approve', role: 'admin' })).status, 403);
  assert.equal((await decide(hospAdmin, { id: state.o1, action: 'approve', role: 'user' })).status, 403);
  const a = await decide(hospAdmin, { id: state.o1, action: 'approve', role: 'aa_admin' });
  assert.equal(a.data.account.role, 'aa_admin');
  assert.deepEqual(a.data.account.hospitals, []);
  const b = await decide(hospAdmin, { id: state.o2, action: 'approve', role: 'aa_user' });
  assert.equal(b.data.account.role, 'aa_user');
  assert.ok(b.data.account.resident_id, 'linked to the officer record created on approval');
  assert.equal(b.data.account.name, 'حيدر كاظم مهدي', 'the job title of a security head has no prefix');
  const rows = rowsOf(await call('GET', `/api/aa/db?h=${H}`, { token: state.owner }));
  const added = rows.find(r => r.c === 'resident' && r.d.phone === '+964' + NEW_PHONE.slice(1));
  assert.ok(added, 'officer record added');
  assert.equal(added.d.spec, JOB_SEC);
  const hosp = rows.find(r => r.c === 'hospital');
  assert.ok(hosp.d.names.some(n => n.id === added.d.id), 'and listed in the hospital record');
  for (const r of rows) state.versions[r.c + '|' + r.id] = r.v;
  state.hospital = hosp.d;
  state.addedId = added.d.id;
  // Switching between the two division roles later.
  assert.equal((await decide(hospAdmin, { id: state.o2, action: 'set_role', role: 'aa_admin' })).data.account.role, 'aa_admin');
  assert.equal((await decide(hospAdmin, { id: state.o2, action: 'set_role', role: 'aa_user' })).data.account.role, 'aa_user');
});

test('officers: their own division only; admins edit it, users exchange duties; nothing of the doctors\' side', async () => {
  const o1 = await login(U.o1, 'o1');
  const o2 = await login(U.o2, 'o2');
  assert.equal(o1.success, true);
  assert.equal(o1.role, 'aa_admin');
  assert.deepEqual(o1.adminHospitals, []);
  state.t1 = o1.token;
  state.t2 = o2.token;
  assert.equal((await call('GET', `/api/aa/db?h=${H}`, { token: state.t1 })).status, 200);
  assert.equal((await call('GET', `/api/aa/db?h=${X}`, { token: state.t1 })).status, 403);
  // The doctors' data: no phone numbers, no writes.
  const main = await call('GET', '/api/db', { token: state.t1 });
  assert.equal(main.data.full, false);
  const anySched = main.data.rows.find(r => r[0] === 'sched');
  const mainWrite = await call('POST', '/api/sync', { token: state.t1, body: { ops: [{ c: 'sched', id: anySched[1], h: anySched[2], o: anySched[3], bv: anySched[4], d: anySched[5] }] } });
  assert.deepEqual(mainWrite.data.rejected, [0]);
  assert.equal((await call('GET', '/api/er', { token: state.t1 })).status, 403);
  assert.equal((await call('GET', '/api/accounts/my-duties?ym=2026-10', { token: state.t1 })).status, 403);
  assert.equal((await call('GET', '/api/accounts?filter=pending', { token: state.t1 })).status, 403, 'officers do not approve accounts');
  // Division admin edits the job titles; division user cannot, but exchanges a duty.
  state.hospital = { ...state.hospital, specialties: state.hospital.specialties.map(s => s.id === JOB_SEC ? { ...s, color: '#991b1b' } : s) };
  assert.equal((await aaSync(state.t1, [{ c: 'hospital', id: H, h: H, o: 0, d: state.hospital }])).applied.length, 1);
  const userEdit = await aaSync(state.t2, [{ c: 'hospital', id: H, h: H, o: 0, d: { ...state.hospital, specialties: [] } }]);
  assert.deepEqual(userEdit.rejected, [0]);
  const swap = await aaSync(state.t2, [{ c: 'sched', id: `${H}:t1${RUN}`, h: H, o: 0, d: { date: today(), specCode: JOB_AO, name: 'حيدر كاظم مهدي', dutyTime: '', dutySlot: 0, VisitCount: 0 } }]);
  assert.equal(swap.applied.length, 1);
  // Contact taps count once per minute on division cards too.
  const v1 = await call('POST', `/api/aa/visit?h=${H}`, { token: state.t2, body: { id: `${H}:t2${RUN}` } });
  const v2 = await call('POST', `/api/aa/visit?h=${H}`, { token: state.t2, body: { id: `${H}:t2${RUN}` } });
  assert.equal(v1.data.count, 1);
  assert.equal(v2.data.cooldown, true);
  // Incremental reads see the swap.
  const since = await call('GET', `/api/aa/db?h=${H}&since=${Date.now() - 60000}`, { token: state.t1 });
  assert.ok(since.data.changed.some(r => r[1] === `${H}:t1${RUN}` && r[5].name === 'حيدر كاظم مهدي'));
});

test('mirror: the doctors\' roster shows only the job titles the hospital chose, read-only', async () => {
  assert.equal((await call('GET', `/api/aa/mirror?h=${H}`)).status, 401, 'nothing for visitors who are not signed in');
  const empty = (await call('GET', `/api/aa/mirror?h=${H}`, { token: state.user })).data.hospital;
  assert.equal(empty.id, MIRROR);
  assert.ok(!empty.specialties.some(s => s.id === JOB_SEC), 'nothing mirrored yet: residents see no job titles');
  assert.equal(empty.schedule.length, 0);
  const forAdmin = (await call('GET', `/api/aa/mirror?h=${H}`, { token: state.admin })).data.hospital;
  assert.ok(forAdmin.specialties.some(s => s.id === JOB_SEC), 'admins see every job title to choose from');

  // The hospital admin mirrors the security head (a clone specialty in the doctors' hospital record).
  const main = await call('GET', '/api/db', { token: state.owner });
  const row = main.data.rows.find(r => r[0] === 'hospital' && r[1] === H);
  state.mainHospital = { v: row[4], d: row[5], o: row[3] };
  const withClone = { ...row[5], specialties: [...row[5].specialties, { id: JOB_SEC, name_ar: 'مسؤول الأمن', isClone: true, clonedFromHospitalId: MIRROR, clonedFromSpecId: JOB_SEC, enabled: true, color: '#991b1b', prefix: '' }] };
  const put = await call('POST', '/api/sync', { token: state.admin, body: { ops: [{ c: 'hospital', id: H, h: H, o: row[3], bv: row[4], d: withClone }] } });
  assert.equal(put.data.applied.length, 1, JSON.stringify(put.data));
  state.mainHospital.v = put.data.applied[0][1];
  // A division admin cannot do that (they never write the doctors' data).
  assert.deepEqual((await call('POST', '/api/sync', { token: state.t1, body: { ops: [{ c: 'hospital', id: H, h: H, o: row[3], bv: state.mainHospital.v, d: row[5] }] } })).data.rejected, [0]);

  const signedIn = (await call('GET', `/api/aa/mirror?h=${H}`, { token: state.user })).data.hospital;
  assert.deepEqual(signedIn.specialties.map(s => s.id), [JOB_SEC]);
  assert.ok(signedIn.schedule.some(e => e.specCode === JOB_SEC && e.name === GUARD.name));
  assert.ok(!signedIn.schedule.some(e => e.specCode === JOB_AO), 'job titles that are not mirrored stay private');
  assert.equal(signedIn.names.find(n => n.name === GUARD.name).phone, GUARD.phone);
});

test('rotators have no board, specialty or stage', async () => {
  const r = await call('POST', '/api/accounts/signup-rotator', { body: { hosp: H, name: 'د. سارة محمد علي', username: U.r, key: await deriveKey(U.r, 'Pass-1234'), sex: 'f' } });
  assert.equal(r.data.ok, true);
  const pending = (await call('GET', '/api/accounts?filter=pending', { token: state.owner })).data.accounts;
  state.r = pending.find(x => x.username === U.r).id;
  await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.r, action: 'approve' } });
  const t = (await login(U.r, 'r1')).token;
  const me = (await call('GET', '/api/accounts/me', { token: t })).data.account;
  assert.equal(me.role, 'rotator');
  // A rotator's type never changes (not by the hospital's admin, not by the owner).
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.admin, body: { id: state.r, action: 'set_role', role: 'user' } })).status, 403);
  assert.equal((await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.r, action: 'set_role', role: 'admin', hospitals: [H] } })).data.error, 'rotator_fixed');
  for (const k of ['board', 'specialty', 'stage', 'board_years', 'profile_complete', 'stage_now']) assert.ok(!(k in me), k);
  assert.equal((await call('POST', '/api/accounts/profile', { token: t, body: { board: 'arab', specialty: 'x', stage: 1, boardYears: 4 } })).data.error, 'no_profile');
  assert.equal((await call('GET', '/api/accounts/profile-suggest', { token: t })).data.suggestion.board, null);
  // The owner's profile edit keeps only sex and hospital for a rotator.
  const setp = await call('POST', '/api/accounts/decide', { token: state.owner, body: { id: state.r, action: 'set_profile', profile: { board: 'arab', specialty: 'x', stage: 2, boardYears: 4, sex: 'f', hosp: X } } });
  assert.equal(setp.data.account.hosp, X);
  assert.ok(!('board' in setp.data.account));
  assert.equal((await call('GET', '/api/accounts/my-duties?ym=2026-10', { token: t })).status, 403);
});

test('cleanup: test accounts, division rows and the mirror', async () => {
  for (const id of [state.o1, state.o2, state.r]) {
    if (id) assert.equal((await call('POST', '/api/accounts/decide', { token: state.owner, body: { id, action: 'delete' } })).data.ok, true);
  }
  if (state.mainHospital) {
    const res = await call('POST', '/api/sync', { token: state.owner, body: { ops: [{ c: 'hospital', id: H, h: H, o: state.mainHospital.o, bv: state.mainHospital.v, d: state.mainHospital.d }] } });
    assert.equal(res.data.applied.length, 1);
  }
  const rows = rowsOf(await call('GET', `/api/aa/db?h=${H}`, { token: state.owner }));
  const mine = rows.filter(r => (r.c === 'sched' && r.id.endsWith(RUN)) || (r.c === 'resident' && [OFFICER.id, GUARD.id, state.addedId].includes(r.id)));
  const hosp = rows.find(r => r.c === 'hospital');
  const cleaned = { ...hosp.d, specialties: hosp.d.specialties.filter(s => ![JOB_AO, JOB_SEC].includes(s.id)), names: hosp.d.names.filter(n => ![OFFICER.id, GUARD.id, state.addedId].includes(n.id)) };
  const res = await call('POST', `/api/aa/sync?h=${H}`, { token: state.owner, body: { ops: [
    ...mine.map(r => ({ c: r.c, id: r.id, bv: r.v, del: 1 })),
    { c: 'hospital', id: H, h: H, o: 0, bv: hosp.v, d: cleaned },
  ] } });
  assert.equal(res.data.applied.length, mine.length + 1, JSON.stringify(res.data));
});
