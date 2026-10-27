// Website statistics (stats.js): who may read what, the summary, the owner's growth analytics and the
// nightly snapshot. Uses the local owner and user accounts (LOCAL_OWNER / LOCAL_USER, password Pass-1234).
// Run: API_BASE=http://127.0.0.1:8890 node --test --test-concurrency=1 worker/test/stats.test.mjs
// (the local Worker started with --test-scheduled, for the snapshot step)
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const OWNER = process.env.LOCAL_OWNER || 'adm_mv7kjvs4';
const USER = process.env.LOCAL_USER || 'usr_mv7kjvs4';

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
const signIn = async u => (await call('POST', '/api/accounts/login', { body: { username: u, key: await deriveKey(u, 'Pass-1234'), deviceId: 'deviceStats-' + u + 'xxxxxxxx', deviceLabel: 'Test' } })).data.token;
const t = {};

test('signed out: refused', async () => {
  assert.equal((await call('GET', '/api/stats/summary')).status, 401);
  assert.equal((await call('GET', '/api/stats/growth')).status, 401);
});

test('a resident: no statistics', async () => {
  t.owner = await signIn(OWNER);
  t.user = await signIn(USER);
  assert.ok(t.owner && t.user);
  assert.equal((await call('GET', '/api/stats/summary', { token: t.user })).status, 403);
  assert.equal((await call('GET', '/api/stats/growth', { token: t.user })).status, 403);
});

test('the owner: the whole site, the counters add up', async () => {
  const r = await call('GET', '/api/stats/summary?h=*', { token: t.owner });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = r.data;
  assert.equal(s.scope, '*');
  assert.ok(s.accounts.active >= 1);
  assert.ok(s.accounts.dau <= s.accounts.wau && s.accounts.wau <= s.accounts.mau && s.accounts.mau <= s.accounts.active, JSON.stringify(s.accounts));
  assert.ok(s.residents.total > 0 && s.residents.linked <= s.residents.total);
  assert.equal(s.series.days.length, 30);
  assert.equal(s.series.interactions.length, 30);
  assert.ok(Array.isArray(s.hospitals) && s.hospitals.length > 0 && s.hospitals.every(h => h.id && h.name));
  for (const k of ['comments', 'likes', 'contacts', 'statuses', 'exchanges', 'opioids']) assert.ok(Number.isInteger(s.activity[k].now) && Number.isInteger(s.activity[k].prev), k);
  // One hospital: no side-by-side list.
  const one = (await call('GET', '/api/stats/summary?h=' + s.hospitals[0].id, { token: t.owner })).data;
  assert.equal(one.scope, s.hospitals[0].id);
  assert.equal(one.hospitals, undefined);
  assert.ok(one.residents.total <= s.residents.total);
});

test('kept for 10 minutes', async () => {
  const r = await call('GET', '/api/stats/summary?h=*', { token: t.owner });
  assert.equal(r.data.cached, true);
});

test('the owner: growth analytics', async () => {
  const r = await call('GET', '/api/stats/growth?days=30', { token: t.owner });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = r.data;
  assert.equal(g.days.length, 30);
  for (const k of ['signups', 'comments', 'likes', 'contacts', 'statuses', 'exchanges', 'opioids', 'edits']) assert.equal(g.series[k].length, 30, k);
  assert.ok(g.breakdown.total >= 1 && g.breakdown.roles);
  assert.ok(Array.isArray(g.hours) && Array.isArray(g.devices) && Array.isArray(g.hospitals));
});

test('the nightly snapshot', async () => {
  const cron = await fetch(BASE + '/__scheduled?cron=' + encodeURIComponent('17 1 * * *'));
  assert.equal(cron.status, 200, 'start the local Worker with --test-scheduled');
  // A fresh answer (another range is not cached yet).
  const g = (await call('GET', '/api/stats/growth?days=31', { token: t.owner })).data;
  assert.ok(g.snapshots.length >= 1, JSON.stringify(g.snapshots));
  const last = g.snapshots[g.snapshots.length - 1];
  assert.ok(Number.isInteger(last.dau) && Number.isInteger(last.accounts), JSON.stringify(last));
});
