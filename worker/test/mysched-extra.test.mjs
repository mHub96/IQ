// My Schedule: duties a resident adds themselves; the ER preferences history (pages of 5) and the
// import of the old Google Form's answers. Uses the local test accounts.
// Run: API_BASE=http://127.0.0.1:8890 node --test --test-concurrency=1 worker/test/mysched-extra.test.mjs
// Afterwards: DELETE FROM er_pref_history WHERE er_name LIKE '%' AND updated_at > <start> (local only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPrefs, anyDutyPlan, customView } from '../src/duties.js';

const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const OWNER = process.env.OWNER_USER || 'adm_mv7kjvs4', USER = process.env.TEST_USER || 'usr_mv7kjvs4', PASS = process.env.TEST_PASS || 'Pass-1234';

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
const login = async u => (await call('POST', '/api/accounts/login', { body: { username: u, key: await deriveKey(u, PASS), deviceId: 'test-mysched-extra-dev', deviceLabel: 'Test' } })).data;

test('preferred and excluded days side by side; older data still read', () => {
  const p = cleanPrefs({ daysPrefer: [3, 5, 40], daysExclude: [5, 9, '12'], prefNote: '  امتحان <b>يوم 15</b>  ' }, '2026-11');
  assert.deepEqual([p.daysPrefer, p.daysExclude], [[3, 5], [9, 12]], 'a day is one or the other (preferred wins inside one save)');
  assert.deepEqual([p.prefDaysMode, p.specificDays], ['exclude', [9, 12]], 'older pages read the days off');
  assert.equal(p.prefNote, 'امتحان bيوم 15/b');
  const old = cleanPrefs({ prefDaysMode: 'prefer', specificDays: [1, 2] }, '2026-11');
  assert.deepEqual([old.daysPrefer, old.daysExclude, old.prefDaysMode], [[1, 2], [], 'prefer']);
  assert.deepEqual(cleanPrefs({ specificDays: [7] }, '2026-11').daysExclude, [7]);
});

test('a custom duty: its plan and view', () => {
  const v = customView('2026-11-03|c|abc123', JSON.stringify({ k: 'own', t: 'عيادة', s: '16:00', e: '20:00' }), 'h1');
  assert.deepEqual([v.src, v.kind, v.title, v.start, v.end, v.hosp], ['custom', 'own', 'عيادة', '16:00', '20:00', 'h1']);
  assert.deepEqual(Object.values(anyDutyPlan(v)).slice(1), [16, 0, 4]);
  const s = customView('2026-11-03|c|abc124', JSON.stringify({ k: 'spec', spec: 'NS' }), 'h1');
  assert.deepEqual(anyDutyPlan(s, { NS: 'جراحة الأعصاب' }), { title: 'جراحة الأعصاب', h: 8, min: 0, len: 24 });
  const e = customView('2026-11-03|c|abc125', JSON.stringify({ k: 'er', type: 'er', slot: 'preNight' }), 'h1');
  assert.deepEqual([anyDutyPlan(e).h, anyDutyPlan(e).len], [20, 6]);
  assert.equal(customView('x|c|y', '{"k":"nope"}', 'h'), null);
});

test('a resident adds, marks and removes a duty of their own', async () => {
  const u = await login(USER);
  assert.ok(u && u.token, 'user login');
  const t = u.token, ym = '2026-12';
  const bad = await call('POST', '/api/accounts/custom-duty', { token: t, body: { date: '2026-02-30', kind: 'own', title: 'x' } });
  assert.equal(bad.data.error, 'bad_date');
  assert.equal((await call('POST', '/api/accounts/custom-duty', { token: t, body: { date: '2026-12-05', kind: 'own' } })).data.error, 'title_required');
  assert.equal((await call('POST', '/api/accounts/custom-duty', { token: t, body: { date: '2026-12-05', kind: 'own', title: 'x', start: '10:00', end: '10:00' } })).data.error, 'bad_time');
  const add = await call('POST', '/api/accounts/custom-duty', { token: t, body: { date: '2026-12-05', kind: 'own', title: 'تغطية ردهة', start: '14:00', end: '20:00' } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const key = add.data.duty.key;
  assert.match(key, /^2026-12-05\|c\|[a-z0-9]+$/);
  let month = (await call('GET', '/api/accounts/my-duties?ym=' + ym, { token: t })).data;
  assert.ok(month.duties.some(d => d.key === key && d.src === 'custom' && d.title === 'تغطية ردهة'), 'in the month');
  assert.ok(month.erPositions && Array.isArray(month.erPositions.er) && month.erPositions.er.length, 'ER positions offered');
  assert.ok(!month.hospitals.includes(undefined));
  const mk = await call('POST', '/api/accounts/duty-mark', { token: t, body: { dkey: key, kind: 'bought', note: 'ملاحظة' } });
  assert.equal(mk.data.mark.kind, 'bought');
  const clr = await call('POST', '/api/accounts/duty-mark', { token: t, body: { dkey: key } });
  assert.equal(clr.data.mark, null);
  month = (await call('GET', '/api/accounts/my-duties?ym=' + ym, { token: t })).data;
  assert.ok(month.duties.some(d => d.key === key), 'clearing its marks keeps the duty');
  assert.ok(!month.marks[key]);
  assert.equal((await call('POST', '/api/accounts/duty-mark', { token: t, body: { dkey: '2026-12-05|c|zzzzzz9' } })).status, 404, 'no mark on a duty that does not exist');
  await call('POST', '/api/accounts/custom-duty', { token: t, body: { dkey: key, remove: true } });
  month = (await call('GET', '/api/accounts/my-duties?ym=' + ym, { token: t })).data;
  assert.ok(!month.duties.some(d => d.key === key), 'removed');
});

test('preferences history: ER admins write and read it in pages of 5; residents only see their own', async () => {
  const o = await login(OWNER), u = await login(USER);
  const hosp = u.account.hosp, erId = 'test_hist_' + Date.now().toString(36);
  for (let m = 1; m <= 7; m++) {
    const r = await call('POST', '/api/er-pref-history', { token: o.token, body: { hosp, ym: `2025-${String(m).padStart(2, '0')}`, erId, erName: 'اختبار', prefs: { daysPrefer: [m], daysExclude: [20], prefNote: 'ملاحظة ' + m } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const p1 = (await call('GET', `/api/er-pref-history?hosp=${hosp}&er=${erId}`, { token: o.token })).data;
  assert.deepEqual(p1.entries.map(e => e.ym), ['2025-07', '2025-06', '2025-05', '2025-04', '2025-03']);
  assert.equal(p1.more, true);
  assert.equal(p1.entries[0].note, 'ملاحظة 7');
  assert.deepEqual(p1.entries[0].prefs.daysPrefer, [7]);
  const p2 = (await call('GET', `/api/er-pref-history?hosp=${hosp}&er=${erId}&before=2025-03`, { token: o.token })).data;
  assert.deepEqual([p2.entries.map(e => e.ym), p2.more], [['2025-02', '2025-01'], false]);
  assert.equal((await call('GET', `/api/er-pref-history?hosp=${hosp}&er=${erId}`, { token: u.token })).status, 403, 'a resident cannot read someone else');
  assert.equal((await call('POST', '/api/er-pref-history', { token: u.token, body: { hosp, ym: '2025-01', erId, prefs: {} } })).status, 403);
  const mine = await call('GET', '/api/er-pref-history/mine', { token: u.token });
  assert.equal(mine.status, 200);
  assert.ok('er' in mine.data && Array.isArray(mine.data.entries));
});

test('import of the old Google Form: names matched, the rest reported', async () => {
  const o = await login(OWNER), u = await login(USER);
  const hosp = u.account.hosp;
  // A real name of the hospital's ER database (not printed).
  let after = 0, page, state = null;
  do { page = (await call('GET', `/api/er?after=${after}`, { token: o.token })).data; for (const r of page.rows) if (r[1] === 'hosp_hub_emergency_state_v3') state = r.find(x => x && typeof x === 'object' && !Array.isArray(x)) || JSON.parse(r.find(x => typeof x === 'string' && x.startsWith('{')) || 'null'); after = page.last; } while (page.more);
  const list = state && ((state.hospitalResidents || {})[hosp] || (state.hospitalId === hosp ? state.residents : null));
  assert.ok(Array.isArray(list) && list.length, 'the hospital has ER residents');
  const pick = list.find(r => r.name && r.name.trim().split(/\s+/).length >= 3) || list[0];
  const r = await call('POST', '/api/er-pref-history/import', { token: o.token, body: { hosp, entries: [
    { name: pick.name, ym: '2024-03', items: [['الملاحظات', 'لا أستطيع يوم الخميس'], ['الوجبات', 'الصباحية']] },
    { name: 'د. اسم غير موجود أبداً زززز', ym: '2024-03', items: [['الملاحظات', 'x']] },
  ] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.saved, r.data.unmatched], [1, ['د. اسم غير موجود أبداً زززز']]);
  const h = (await call('GET', `/api/er-pref-history?hosp=${hosp}&er=${encodeURIComponent(pick.id)}&before=2024-04`, { token: o.token })).data;
  const e = h.entries.find(x => x.ym === '2024-03');
  assert.ok(e && e.imported && e.imported.items[0][1] === 'لا أستطيع يوم الخميس');
  // A later save of the same month keeps the imported answers.
  await call('POST', '/api/er-pref-history', { token: o.token, body: { hosp, ym: '2024-03', erId: String(pick.id), erName: pick.name, prefs: { prefNote: 'جديد' } } });
  const h2 = (await call('GET', `/api/er-pref-history?hosp=${hosp}&er=${encodeURIComponent(pick.id)}&before=2024-04`, { token: o.token })).data;
  const e2 = h2.entries.find(x => x.ym === '2024-03');
  assert.deepEqual([e2.note, e2.imported.items.length], ['جديد', 2]);
  assert.equal((await call('POST', '/api/er-pref-history/import', { token: u.token, body: { hosp, entries: [] } })).status, 403);
});
