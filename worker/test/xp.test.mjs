// XP leaderboard and the resident of the month (worker/src/xp.js).
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/xp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dutyDayNow } from '../src/profile.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));

async function call(method, p, { token } = {}) {
  const res = await fetch(BASE + p, { method, headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const t = {};

test('setup', async () => {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: DATA.globalPasswords.owner }) });
  t.owner = (await res.json()).token;
  // The hospital with the most duties, and the months it has duties in.
  let after = 0, page; t.sched = [];
  do { page = (await call('GET', `/api/db?after=${after}`, { token: t.owner })).data; t.sched.push(...page.rows.filter(r => r[0] === 'sched').map(r => ({ ...r[5], hospitalId: r[2] }))); after = page.last; } while (page.more);
  const counts = {};
  for (const s of t.sched) if (s.hospitalId) counts[s.hospitalId] = (counts[s.hospitalId] || 0) + 1;
  t.h = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([h]) => h)[0];
  assert.ok(t.h, 'a hospital with duties');
});

test('resident of the month: last month\'s most points, on the leaderboard and its own endpoint', async () => {
  assert.equal((await call('GET', `/api/leaderboard/star?h=${t.h}`)).status, 401);
  assert.equal((await call('GET', '/api/leaderboard/star?h=bad%20id', { token: t.owner })).status, 400);
  const star = await call('GET', `/api/leaderboard/star?h=${t.h}`, { token: t.owner });
  assert.equal(star.status, 200, JSON.stringify(star.data));
  const all = await call('GET', `/api/leaderboard?h=${t.h}&p=all`, { token: t.owner });
  assert.equal(all.status, 200);
  assert.equal(all.data.xpRules.monthTop, 150);
  const m = dutyDayNow().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  if (star.data.star) {
    assert.equal(star.data.star.ym, prev);
    assert.ok(star.data.star.key && star.data.star.xp > 0);
    assert.deepEqual(all.data.star, { name: star.data.star.name, ym: prev, xp: star.data.star.xp });
    // The winner holds at least one "resident of the month" trophy.
    const row = all.data.rows.find(r => r.name === star.data.star.name);
    assert.ok(row && row.stats.monthTops >= 1, JSON.stringify(row && row.stats));
  } else {
    assert.equal(all.data.star, null);
  }
  // Month trophies are counted once per finished month at most.
  const months = new Set();
  for (const s of t.sched.filter(x => x.hospitalId === t.h)) { const d = String(s.date || '').split('/'); if (d.length === 3) months.add(`${d[2]}-${d[1].padStart(2, '0')}`); }
  const total = all.data.rows.reduce((n, r) => n + (r.stats.monthTops || 0), 0);
  assert.ok(total <= [...months].filter(x => x < m).length, `${total} trophies`);
});
