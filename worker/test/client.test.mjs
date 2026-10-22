// Runs the real hub-sync.js + hub-core.js in simulated browsers against a running Worker.
// Needs a freshly imported database: the tests change data.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
// A private data snapshot (never committed): worker/.local/test-hub-data.json, or HUB_DATA=<path>.
const DATA_FILE = process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json');
const SOURCE = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const PW = SOURCE.globalPasswords;
const code = ['hub-sync.js', 'hub-core.js'].map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);

/** A fresh simulated browser tab with its own localStorage. */
function browser(initialStorage = {}) {
  class Storage {
    constructor() { Object.defineProperty(this, '_m', { value: new Map(), enumerable: false }); }
    get length() { return this._m.size; }
    key(i) { return [...this._m.keys()][i] ?? null; }
    getItem(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
    setItem(k, v) { this._m.set(String(k), String(v)); }
    removeItem(k) { this._m.delete(String(k)); }
    clear() { this._m.clear(); }
  }
  const events = new EventTarget();
  const sandbox = {
    Storage, console, fetch, setTimeout, clearTimeout, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, JSON, Math, Date, Promise, Map, Set, Error,
    CustomEvent, BroadcastChannel: undefined,
    location: { search: '', pathname: '/index.html', hash: '' },
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      documentElement: { setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} },
      querySelectorAll: () => [],
      getElementById: () => null,
      body: null,
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  sandbox.localStorage = new sandbox.Storage();
  sandbox.sessionStorage = new sandbox.Storage();
  vm.runInContext('localStorage = window.localStorage; sessionStorage = window.sessionStorage;', sandbox);
  for (const [k, v] of Object.entries(initialStorage)) sandbox.localStorage.setItem(k, v);
  sandbox.localStorage.setItem('hub_api_base', BASE);
  for (const [file, src] of code) vm.runInContext(src, sandbox, { filename: file });
  return sandbox;
}

const settle = () => new Promise(r => setTimeout(r, 300));
async function signedIn(password) {
  const b = browser();
  const res = await b.Hub.auth.login(password, true);
  assert.equal(res.success, true, 'login ' + JSON.stringify(res));
  await settle();
  await b.Hub.loadDatabase(true);
  return b;
}

test('a guest loads nothing (nothing of the site is visible without signing in)', async () => {
  const b = browser();
  const db = await b.Hub.loadDatabase();
  assert.equal(Object.keys(db.hospitals || {}).length, 0);
  assert.equal((db.residents || []).length, 0);
  // Only the hospitals' names, for the sign-up form.
  const list = await b.Hub.getPublicHospitals();
  assert.equal(list.length, Object.keys(SOURCE.hospitals).length);
  assert.ok(list.every(h => h.id && !h.names && !h.specialties));
});

test('login, then the full database including phones', async () => {
  const b = await signedIn(PW.user);
  assert.equal(b.Hub.auth.getRole(), 'user');
  const db = b.Hub.getDatabase();
  assert.ok(db.residents.some(r => r.phone));
  assert.equal(db.globalPasswords, undefined, 'non-owners never see passwords');
  assert.equal(b.localStorage.getItem('hospital_hub_session_token'), null, 'password not stored');
});

test('a session from the old site version is upgraded silently', async () => {
  const b = browser({
    hospital_hub_session_role: 'admin',
    hospital_hub_session_timestamp: String(Date.now()),
    hospital_hub_session_remember: 'true',
    hospital_hub_session_token: Buffer.from(PW.admin, 'latin1').toString('base64'),
  });
  await b.Hub.loadDatabase();
  assert.equal(b.Hub.auth.getRole(), 'admin');
  assert.equal(b.Hub.getSyncStatus().signedIn, true);
  assert.equal(b.localStorage.getItem('hospital_hub_session_token'), null);
});

test('first save after loading uploads nothing unexpected', async () => {
  const b = await signedIn(PW.owner);
  const status = b.Hub.getSyncStatus();
  console.log('pending changes right after load (sanitizer normalisation):', status.pendingChanges);
  await b.Hub.saveDatabase('Converge after import');
  await b.Hub.loadDatabase(true);
  assert.equal(b.Hub.getSyncStatus().pendingChanges, 0);
});

test('a user exchanges a duty in their hospital and another device sees it', async () => {
  const hid = 'iraqi';
  const own = 'own-hospital-user-' + Date.now().toString(36);       // the hospital's own user password
  const owner = await signedIn(PW.owner);
  await owner.Hub.api('PUT', '/api/secrets', { secrets: { [hid]: { user: own } } });
  const a = await signedIn(own);
  await assert.rejects(a.Hub.exchangeDuty('basra', 'GS', 'د. اختبار التبديل', a.Hub.getMedicalDate()), /مستشفاك فقط/);
  const today = a.Hub.getMedicalDate();
  await a.Hub.exchangeDuty(hid, 'GS', 'د. اختبار التبديل', today);
  const b = await signedIn(PW.user);
  const found = b.Hub.getHospital(hid).schedule.some(s => s.date === today && s.specCode === 'GS' && s.name === 'د. اختبار التبديل');
  await owner.Hub.api('PUT', '/api/secrets', { secrets: { [hid]: { user: PW.user } } });
  assert.ok(found);
});

test('two admins edit the same hospital at once: both changes survive', async () => {
  const a = await signedIn(PW.admin);
  const b = await signedIn(PW.admin);
  a.Hub.getHospital('basra').location = 'Location from A';
  b.Hub.getHospital('basra').rotationHeroesUrl = 'https://example.org/from-b';
  await a.Hub.saveDatabase('A edits');
  await b.Hub.saveDatabase('B edits');   // stale base -> conflict -> merge -> retry
  const c = await signedIn(PW.user);
  assert.equal(c.Hub.getHospital('basra').location, 'Location from A');
  assert.equal(c.Hub.getHospital('basra').rotationHeroesUrl, 'https://example.org/from-b');
});

test('a deleted resident is not brought back by a stale device', async () => {
  const a = await signedIn(PW.admin);
  const stale = await signedIn(PW.admin);
  const victim = a.Hub.getDatabase().residents[3];
  await a.Hub.deleteResident(victim.id);
  stale.Hub.getHospital('mawani').location = 'stale device edit';
  await stale.Hub.saveDatabase('stale save');
  const c = await signedIn(PW.user);
  assert.equal(c.Hub.getDatabase().residents.some(r => r.id === victim.id), false);
  assert.equal(c.Hub.getHospital('mawani').location, 'stale device edit');
});

test('refresh keeps unsaved local edits and object identity', async () => {
  const a = await signedIn(PW.admin);
  const other = await signedIn(PW.admin);
  const hospRef = a.Hub.getHospital('iraqi');
  hospRef.location = 'unsaved local edit';
  other.Hub.getHospital('iraqi').rotationHeroesUrl = 'https://example.org/other';
  await other.Hub.saveDatabase('other device');
  await a.Hub.loadDatabase(true);
  assert.equal(a.Hub.getHospital('iraqi'), hospRef, 'same object');
  assert.equal(hospRef.location, 'unsaved local edit');
  assert.equal(hospRef.rotationHeroesUrl, 'https://example.org/other');
});

test('a user cannot change hospital settings; the change is rolled back', async () => {
  const u = await signedIn(PW.user);
  const before = u.Hub.getHospital('iraqi').name_ar;
  u.Hub.getHospital('iraqi').name_ar = 'not allowed';
  await assert.rejects(u.Hub.saveDatabase('user tries'));
  assert.equal(u.Hub.getHospital('iraqi').name_ar, before);
});

test('ICU stats saved by anaesthesia', async () => {
  const a = await signedIn(PW.anaesthesia);
  await a.Hub.updateICUStats('fayhaa', { totalBeds: 9, functionalBeds: 8, occupiedBeds: 6, notes: 'test' });
  const b = await signedIn(PW.user);
  assert.equal(b.Hub.getICUStats('fayhaa').occupiedBeds, 6);
});

test('contact taps reach the server', async () => {
  const a = await signedIn(PW.user);
  const hosp = a.Hub.getHospital('iraqi');
  const today = a.Hub.getMedicalDate();
  const entry = hosp.schedule.find(s => s.date === today);
  assert.ok(entry, 'someone on duty today');
  const before = entry.VisitCount || 0;
  await a.Hub.incrementVisitCount('iraqi', entry.name, entry.specCode);
  await settle();
  const b = await signedIn(PW.user);
  const again = b.Hub.getHospital('iraqi').schedule.find(s => s.date === today && s.name === entry.name && s.specCode === entry.specCode);
  assert.equal(again.VisitCount, before + 1);
  assert.equal(a.Hub.getSyncStatus().pendingChanges, 0, 'tap leaves nothing to re-upload');
});

test('the owner sees and changes passwords through the existing functions', async () => {
  const o = await signedIn(PW.owner);
  assert.equal(o.Hub.getDatabase().globalPasswords.user, PW.user);
  await o.Hub.updateHospitalPasswords('sayyab', { user: 'sayyab-user-new' });
  assert.equal((await browser().Hub.auth.verifyPassword('sayyab-user-new')).role, 'user');
  await o.Hub.updateHospitalPasswords('sayyab', { user: SOURCE.hospitals.sayyab.passwords.user });
});

test('a later page view downloads only the changes, including deletions', async () => {
  const a = await signedIn(PW.admin);
  const b = await signedIn(PW.admin);
  const before = a.Hub.getHospital('mawani').schedule.length;
  const victim = b.Hub.getHospital('mawani').schedule[0];
  b.Hub.getHospital('mawani').schedule.splice(0, 1);
  b.Hub.getHospital('mawani').location = 'delta-check';
  await b.Hub.saveDatabase('delta test');

  const calls = [];
  const realFetch = a.fetch;
  a.fetch = (url, opts) => { calls.push(String(url)); return realFetch(url, opts); };
  vm.runInContext('fetch = window.fetch', a);
  await a.Hub.loadDatabase(true);
  assert.ok(calls.some(u => u.includes('/api/db?since=')), 'used the incremental endpoint');
  assert.ok(!calls.some(u => u.includes('/api/db?after=')), 'no full download');
  assert.equal(a.Hub.getHospital('mawani').location, 'delta-check');
  assert.equal(a.Hub.getHospital('mawani').schedule.length, before - 1);
  assert.equal(a.Hub.getHospital('mawani').schedule.includes(victim), false);
});

test('a new page on the same device starts from the cached rows and stays consistent', async () => {
  const a = await signedIn(PW.user);
  await new Promise(r => setTimeout(r, 400)); // cache write is debounced
  const storage = Object.fromEntries([...Array(a.localStorage.length).keys()].map(i => [a.localStorage.key(i), a.localStorage.getItem(a.localStorage.key(i))]));
  delete storage.hub_api_base;
  const next = browser(storage);
  assert.ok(next.Hub.getDatabase().residents.length > 0, 'instant data from cache before any request');
  await next.Hub.loadDatabase();
  assert.equal(next.Hub.getSyncStatus().pendingChanges, a.Hub.getSyncStatus().pendingChanges);
});

test('signing out removes cached personal data from the device', async () => {
  const a = await signedIn(PW.user);
  await new Promise(r => setTimeout(r, 400));
  assert.ok(a.localStorage.getItem('hospital_hub_rows_v1'));
  a.Hub.auth.logout();
  assert.equal(a.localStorage.getItem('hospital_hub_rows_v1'), null);
  assert.equal(a.localStorage.getItem('hospital_hub_api_token'), null);
});

test('ER migration: the phone with the real schedule wins over an almost empty one that synced first', async () => {
  const key = 'hosp_hub_emergency_sched_basra_2026_11';
  const small = JSON.stringify({ '1': {} });
  const real = JSON.stringify({ '1': { morning: ['د. أ', 'د. ب'], night: ['د. ج'] }, '2': { morning: ['د. د'] } });
  const first = browser({ [key]: small });
  await first.Hub.auth.login(PW.admin, true);
  await settle();
  await first.Hub.er.pull();
  const second = browser({ [key]: real });
  await second.Hub.auth.login(PW.owner, true);
  await settle();
  await second.Hub.er.pull();
  assert.equal(second.localStorage.getItem(key), real, 'device keeps its real schedule');
  await first.Hub.er.pull();
  assert.equal(first.localStorage.getItem(key), real, 'the other device now gets the real schedule');
});

test('ER schedules: a device-only schedule is uploaded and appears on another admin device', async () => {
  const key = 'hosp_hub_emergency_sched_iraqi_2026_10';
  const value = JSON.stringify({ '1': { morning: ['د. أ'], night: ['د. ب'] } });
  const a = browser({ [key]: value });
  await a.Hub.auth.login(PW.admin, true);
  await settle();
  await a.Hub.er.pull();
  const b = browser();
  await b.Hub.auth.login(PW.owner, true);
  await settle();
  await b.Hub.er.pull();
  assert.equal(b.localStorage.getItem(key), value);
  // Edit on B, pull on A
  b.localStorage.setItem(key, JSON.stringify({ '1': { morning: ['د. ج'] } }));
  await b.Hub.er.push();
  await new Promise(r => setTimeout(r, 1800));
  await b.Hub.er.push();
  await a.Hub.er.pull();
  assert.deepEqual(JSON.parse(a.localStorage.getItem(key)), { '1': { morning: ['د. ج'] } });
});
