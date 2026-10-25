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
  assert.equal(all.data.xpRules.monthTop, 200);
  assert.ok(all.data.xpRules.visit > all.data.xpRules.duty / 2 && all.data.xpRules.like < all.data.xpRules.visit, 'contacts weigh more, likes little');
  assert.ok('popular' in all.data, 'the popularity title');
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

test('busy duties beat quiet ones: 30 duties with 1 contact < 3 duties with 10 contacts each', async () => {
  const RUN = Date.now().toString(36).slice(-6);
  const h = 'xp' + RUN;   // a hospital of its own (the leaderboard is cached per hospital)
  const quiet = 'د. هادئ الخفارات', busy = 'د. مشغول الخفارات';
  const ops = [];
  const day = i => { const d = new Date(Date.UTC(2025, 0, 1 + i)); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  for (let i = 0; i < 30; i++) ops.push({ c: 'sched', id: `${h}:q-${i}`, h, o: 99000 + i, bv: 0, d: { date: day(i), specCode: 'GS', name: quiet, timestamp: '08:00', VisitCount: i === 0 ? 1 : 0 } });
  for (let i = 0; i < 3; i++) ops.push({ c: 'sched', id: `${h}:b-${i}`, h, o: 99100 + i, bv: 0, d: { date: day(40 + i), specCode: 'GS', name: busy, timestamp: '08:00', VisitCount: 10 } });
  const sync = body => fetch(BASE + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.owner }, body: JSON.stringify(body) }).then(r => r.json());
  const put = await sync({ msg: 'xp test', ops });
  assert.equal((put.applied || []).length, ops.length, JSON.stringify(put).slice(0, 300));
  try {
    const lb = (await call('GET', `/api/leaderboard?h=${h}&p=all`, { token: t.owner })).data;
    const q = lb.rows.find(r => r.name === quiet), b = lb.rows.find(r => r.name === busy);
    const R = lb.xpRules;
    // Titles (alone in their month here: resident of the month, star of the day) are counted apart.
    const titles = r => (r.stats.topDays || 0) * R.topDay + (r.stats.monthTops || 0) * R.monthTop + (r.stats.populars || 0) * R.popular;
    const qWork = q.xp - titles(q), bWork = b.xp - titles(b);
    assert.equal(qWork, 30 * R.duty + R.dutyBoost + R.visit, 'quiet: 1 XP a duty, one boosted by its contact');
    assert.equal(bWork, 3 * (R.duty + 10 * R.dutyBoost) + 30 * R.visit, 'busy: each duty boosted by its 10 contacts');
    assert.ok(bWork > qWork * 5, `${bWork} vs ${qWork}`);
    assert.equal(q.stats.topDays, 1, 'a quiet duty never makes the star of the day (only the day with a contact)');
    assert.equal(b.stats.topDays, 3);
    assert.equal(q.stats.monthTops, 1, 'alone in January with one contact: the most active there');
    assert.equal(q.stats.duties, 30, 'the duty count stays visible');
  } finally {
    await sync({ msg: 'xp test cleanup', ops: ops.map((o, i) => ({ c: 'sched', id: o.id, bv: put.applied[i] ? put.applied[i].v || 1 : 1, del: 1 })) });
  }
});
