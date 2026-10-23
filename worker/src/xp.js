/**
 * Experience points, levels and trophies of the residents (the leaderboard and the profile).
 *
 * Everything is computed from what the site already records, per hospital and per resident (by name
 * key, as the duty cards are): duties served, contact taps received (VisitCount), likes and comments
 * on their cards, duties taken over for colleagues (approved exchanges), contact requests answered,
 * days in the operating theatre (on-call status) and days as the hospital's most contacted resident.
 * Results are cached for a few minutes per hospital (Cache API), so the leaderboard costs few reads.
 */

import { json } from './lib.js';
import { nameKey, isoDate } from './names.js';
import { dutyDayNow } from './profile.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const CACHE_SECONDS = 300;

/** Points per thing done. */
export const XP = { duty: 40, visit: 5, like: 4, comment: 3, exchange: 25, answered: 15, theatre: 10, topDay: 30 };

/** Level from XP: each level needs 100 XP more than the one before (100, 200, 300, ...). */
export function levelOf(xp) {
  const level = Math.floor((Math.sqrt(1 + 8 * Math.max(0, xp) / 100) - 1) / 2) + 1;
  const start = 100 * (level - 1) * level / 2;
  const next = 100 * level * (level + 1) / 2;
  return { level, start, next };
}
export const TIERS = [
  { min: 30, id: 'legend', name: 'أسطوري' }, { min: 20, id: 'diamond', name: 'ماسي' }, { min: 15, id: 'platinum', name: 'بلاتيني' },
  { min: 10, id: 'gold', name: 'ذهبي' }, { min: 5, id: 'silver', name: 'فضي' }, { min: 1, id: 'bronze', name: 'برونزي' },
];
export const tierOf = level => TIERS.find(t => level >= t.min) || TIERS[TIERS.length - 1];

/** Trophies: [id, icon, name, what is counted, thresholds (bronze, silver, gold), description]. */
export const TROPHIES = [
  ['duty', '🩺', 'حارس المستشفى', 'duties', [1, 25, 100], 'خفارات أدّيتها'],
  ['visit', '📞', 'الأكثر طلباً', 'visits', [50, 250, 1000], 'مرات تواصل الزملاء معك'],
  ['like', '❤️', 'محبوب الزملاء', 'likes', [10, 50, 200], 'إعجابات على بطاقاتك'],
  ['comment', '💬', 'حديث القسم', 'comments', [10, 50, 150], 'تعليقات على بطاقاتك'],
  ['exchange', '🤝', 'يد العون', 'exchanges', [1, 10, 30], 'خفارات تسلّمتها عن زملائك'],
  ['answered', '⚡', 'سريع الاستجابة', 'answered', [5, 25, 100], 'طلبات تواصل أجبتها'],
  ['theatre', '🩸', 'سيد صالة العمليات', 'theatre', [5, 25, 75], 'أيام في صالة العمليات'],
  ['topDay', '🌟', 'نجم اليوم', 'topDays', [1, 10, 30], 'أيام كنت فيها الأكثر تواصلاً في مستشفاك'],
];
const TIER_NAMES = ['برونزية', 'فضية', 'ذهبية'];

function trophiesOf(s) {
  return TROPHIES.map(([id, icon, name, field, steps, desc]) => {
    const value = s[field] || 0;
    const tier = steps.filter(t => value >= t).length;          // 0 = not earned yet
    const next = steps[tier] || null;
    return { id, icon, name, desc, value, tier, tierName: tier ? TIER_NAMES[tier - 1] : null, next };
  });
}
function xpOf(s) {
  return s.duties * XP.duty + s.visits * XP.visit + s.likes * XP.like + s.comments * XP.comment
    + s.exchanges * XP.exchange + s.answered * XP.answered + s.theatre * XP.theatre + s.topDays * XP.topDay;
}
const blank = () => ({ duties: 0, visits: 0, likes: 0, comments: 0, exchanges: 0, answered: 0, theatre: 0, topDays: 0 });

/**
 * Per resident of a hospital: { key -> { name, spec, all: stats, month: stats, today: stats } }.
 * Duties count up to today (served); everything else counts as recorded.
 */
async function hospitalStats(env, hosp) {
  const cache = caches.default;
  const cacheKey = new Request(`https://xp.internal/${encodeURIComponent(hosp)}`);
  const hit = await cache.match(cacheKey).catch(() => null);
  if (hit) return hit.json();

  const today = dutyDayNow();
  const month = today.slice(0, 7);
  const [sched, likes, comments, exch, reqs, status] = await env.DB.batch([
    env.DB.prepare(
      `SELECT json_extract(data, '$.name') AS n, json_extract(data, '$.date') AS d, json_extract(data, '$.specCode') AS s,
              COALESCE(json_extract(data, '$.VisitCount'), 0) AS v, json_extract(data, '$.isClone') AS c
         FROM records WHERE coll = 'sched' AND hosp = ?`
    ).bind(hosp),
    env.DB.prepare("SELECT target, COUNT(*) AS c FROM likes WHERE target LIKE ? GROUP BY target").bind(`duty:${hosp}:%`),
    env.DB.prepare('SELECT target, COUNT(*) AS c FROM comments WHERE hosp = ? AND deleted = 0 GROUP BY target').bind(hosp),
    env.DB.prepare("SELECT new_name AS n, date AS d FROM exchange_requests WHERE hosp = ? AND status = 'approved'").bind(hosp),
    env.DB.prepare("SELECT holder_key AS k, card_date AS d FROM contact_requests WHERE hosp = ? AND status = 'done'").bind(hosp),
    env.DB.prepare("SELECT target, card_date AS d FROM duty_status WHERE hosp = ? AND status = 'or'").bind(hosp),
  ]);
  const people = {};
  const person = (key, name, spec) => {
    if (!people[key]) people[key] = { name: name || key, spec: spec || '', all: blank(), month: blank(), today: blank() };
    else if (spec && !people[key].spec) people[key].spec = spec;
    return people[key];
  };
  const add = (p, field, iso, n = 1) => {
    p.all[field] += n;
    if (iso && iso.startsWith(month)) p.month[field] += n;
    if (iso === today) p.today[field] += n;
  };
  const visitsByDay = {};
  const served = new Set();   // one duty per resident per day (two specialties the same day are one duty)
  for (const r of sched.results || []) {
    if (r.c || !r.n) continue;
    const iso = isoDate(r.d);
    const key = nameKey(r.n);
    if (!iso || !key) continue;
    const p = person(key, r.n, r.s);
    if (iso <= today && !served.has(key + '|' + iso)) { served.add(key + '|' + iso); add(p, 'duties', iso); }
    if (r.v > 0) {
      add(p, 'visits', iso, r.v);
      const day = visitsByDay[iso] || (visitsByDay[iso] = {});
      day[key] = (day[key] || 0) + r.v;
    }
  }
  // The day's most contacted resident (finished days and today).
  for (const [iso, byKey] of Object.entries(visitsByDay)) {
    const top = Object.entries(byKey).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0 && people[top[0]]) add(people[top[0]], 'topDays', iso);
  }
  const fromTarget = t => { const parts = String(t).split(':'); return { iso: parts[2], key: parts.slice(3).join(':') }; };
  for (const r of likes.results || []) { const { iso, key } = fromTarget(r.target); if (people[key]) add(people[key], 'likes', iso, r.c); }
  for (const r of comments.results || []) { const { iso, key } = fromTarget(r.target); if (people[key]) add(people[key], 'comments', iso, r.c); }
  for (const r of exch.results || []) { const key = nameKey(r.n); if (people[key]) add(people[key], 'exchanges', isoDate(r.d)); }
  for (const r of reqs.results || []) { if (people[r.k]) add(people[r.k], 'answered', r.d); }
  for (const r of status.results || []) { const { iso, key } = fromTarget(r.target); if (people[key]) add(people[key], 'theatre', iso); }

  const out = { at: Date.now(), today, people };
  await cache.put(cacheKey, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } })).catch(() => {});
  return out;
}

export async function routeXp(path, method, request, env, auth, url) {
  if (method !== 'GET') return null;
  if (path === '/api/leaderboard') return leaderboard(env, auth, url);
  if (path === '/api/xp/me') return myXp(env, auth);
  return null;
}

/** ?h=<hospital>&p=today|month|all: the ranking of the period, with everyone's level and trophies. */
async function leaderboard(env, auth, url) {
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const hosp = String(url.searchParams.get('h') || '');
  const period = ['today', 'month', 'all'].includes(url.searchParams.get('p')) ? url.searchParams.get('p') : 'month';
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  const stats = await hospitalStats(env, hosp);
  // Avatars of the residents who have an account in this hospital.
  const { results: accs } = await env.DB.prepare(
    "SELECT name_key, avatar, sex FROM accounts WHERE status = 'active' AND role <> 'rotator' AND (hosp = ?1 OR EXISTS (SELECT 1 FROM json_each(accounts.hospitals) WHERE value = ?1))"
  ).bind(hosp).all();
  const look = new Map((accs || []).map(a => [a.name_key, a]));
  const myKey = auth.a && auth.r !== 'rotator' ? nameKey(auth.name || '') : null;
  const rows = Object.entries(stats.people).map(([key, p]) => {
    const xpAll = xpOf(p.all);
    const lv = levelOf(xpAll);
    const a = look.get(key);
    return {
      key: key === myKey ? 'me' : undefined, name: p.name, spec: p.spec,
      xp: xpOf(p[period]), total: xpAll, level: lv.level, tier: tierOf(lv.level).id,
      trophies: trophiesOf(p.all).filter(t => t.tier).length,
      stats: p[period],
      avatar: a && a.avatar ? (() => { try { return JSON.parse(a.avatar); } catch { return null; } })() : null, sex: a ? a.sex : null,
    };
  }).filter(r => r.xp > 0).sort((a, b) => b.xp - a.xp || b.total - a.total);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const mine = rows.find(r => r.key === 'me') || null;
  return json({ ok: true, period, hosp, at: stats.at, rows: rows.slice(0, 50), me: mine && mine.rank > 50 ? mine : null, xpRules: XP });
}

/** The signed-in resident's XP, level, tier and trophies (all their hospitals). */
async function myXp(env, auth) {
  if (!auth || !auth.a) return json({ error: 'account_required' }, 403);
  const acc = await env.DB.prepare('SELECT name_key, role, hosp, resident_id FROM accounts WHERE id = ?').bind(auth.a).first();
  if (!acc || acc.role === 'rotator') return json({ ok: true, none: true });
  const hosps = new Set([acc.hosp]);
  if (acc.resident_id) {
    const rec = await env.DB.prepare("SELECT json_extract(data, '$.hospitals') AS hs FROM records WHERE coll = 'resident' AND id = ?").bind(acc.resident_id).first();
    try { for (const h of JSON.parse((rec && rec.hs) || '[]')) hosps.add(String(h)); } catch {}
  }
  const total = blank();
  let monthXp = 0;
  for (const h of hosps) {
    if (!HOSP_RE.test(h || '')) continue;
    const p = (await hospitalStats(env, h)).people[acc.name_key];
    if (!p) continue;
    for (const k of Object.keys(total)) total[k] += p.all[k];
    monthXp += xpOf(p.month);
  }
  const xp = xpOf(total);
  const lv = levelOf(xp);
  return json({ ok: true, xp, monthXp, level: lv.level, levelStart: lv.start, levelNext: lv.next, tier: tierOf(lv.level), stats: total, trophies: trophiesOf(total), xpRules: XP });
}
