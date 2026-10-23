// Two residents of a hospital with the same name: "My Schedule" gives each one their own duties — by the
// duty's resident id when it has one, else by whose specialty the duty is (worker/src/duties.js).
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/namesakes.test.mjs
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
const row = (all, c, id) => all.find(r => r[0] === c && r[1] === id);
const sync = (token, ops) => call('POST', '/api/sync', { token, body: { msg: 'namesakes test', ops } });
const t = {};
const YM = '2031-03';
const day = n => `${String(n).padStart(2, '0')}/03/2031`;

test('setup: a resident with an account, and a namesake in another specialty of the same hospital', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  const all = await rows(t.owner);
  const accounts = (await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts;
  const taken = new Set(accounts.map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  const plain = (specs, id) => { const s = specs.find(x => x.id === id); return s && !s.parentSpec && !(s.acceptPool || []).length && !specs.some(x => x.parentSpec === id); };
  for (const r of residents) {
    const h = (r.hospitals || [])[0];
    const specs = (row(all, 'hospital', h) || [])[5]?.specialties || [];
    const own = r.dept || r.spec;
    if (!h || taken.has(r.id) || r.active === false || phones.get(r.phone) !== 1 || !/^\+?9647\d{9}$/.test(r.phone || '') || !plain(specs, own)) continue;
    const other = specs.find(s => s.id !== own && plain(specs, s.id) && !s.isClone);
    if (other) { Object.assign(t, { res: r, h, own, other: other.id }); break; }
  }
  assert.ok(t.res, 'a resident');
  // The namesake: same name, other specialty, same hospital.
  t.twin = { id: 'res-twin-' + RUN, name: t.res.name, phone: '+9647000' + String(Date.now()).slice(-6), spec: t.other, tag: t.other, dept: t.other, department: t.other, active: true, hospitals: [t.h] };
  assert.equal((await sync(t.owner, [{ c: 'resident', id: t.twin.id, h: null, o: 99999, bv: 0, d: t.twin }])).data.applied.length, 1);
  const username = 'twin_' + RUN, key = await deriveKey(username, 'pass-T-1');
  assert.equal((await call('POST', '/api/accounts/signup', { body: { hosp: t.h, name: t.res.name, phone: t.res.phone, username, key, sex: 'm' } })).status, 200);
  t.accountId = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'approve' } });
  const li = (await call('POST', '/api/accounts/login', { body: { username, key, deviceId: 'deviceT-' + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  t.tok = li.token;
  // Three duties under the shared name: own specialty, the namesake's, and the namesake's with this resident's id.
  t.ids = ['own', 'twin', 'stamped'].map(n => `${t.h}:twin-${RUN}-${n}`);
  const duty = (id, spec, d, extra = {}) => ({ c: 'sched', id, h: t.h, o: 99000, bv: 0, d: { date: day(d), specCode: spec, name: t.res.name, timestamp: '08:00', VisitCount: 0, ...extra } });
  const r = await sync(t.owner, [duty(t.ids[0], t.own, 3), duty(t.ids[1], t.other, 4), duty(t.ids[2], t.other, 5, { resId: t.res.id })]);
  assert.equal(r.data.applied.length, 3);
});

test('My Schedule: own specialty yes, the namesake\'s no, a duty with this resident\'s id yes', async () => {
  const mine = (await call('GET', `/api/accounts/my-duties?ym=${YM}`, { token: t.tok })).data;
  const dates = (mine.duties || []).filter(d => d.src === 'hospital').map(d => d.date).sort();
  assert.deepEqual(dates, ['2031-03-03', '2031-03-05'], JSON.stringify(mine.duties));
});

test('cleanup', async () => {
  const all = await rows(t.owner);
  const ops = t.ids.map(id => row(all, 'sched', id)).filter(Boolean).map(r => ({ c: 'sched', id: r[1], bv: r[4], del: 1 }));
  const tw = row(all, 'resident', t.twin.id);
  if (tw) ops.push({ c: 'resident', id: tw[1], bv: tw[4], del: 1 });
  await sync(t.owner, ops);
  if (t.accountId) assert.equal((await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: t.accountId, action: 'delete' } })).data.ok, true);
});
