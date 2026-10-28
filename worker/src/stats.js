/**
 * Website statistics.
 *   GET /api/stats/summary?h=<hospital|*>  the dashboard: accounts, active users, residents coverage,
 *                                          interactions of the last 30 days (and the 30 before) and a
 *                                          30-day series. A hospital's admins: their hospitals; the
 *                                          owner: any hospital or the whole site ('*').
 *   GET /api/stats/growth?days=N           the owner's analytics: daily series, nightly snapshots,
 *                                          peak hours, devices, accounts breakdowns, feature adoption,
 *                                          the hospitals side by side.
 * Answers are kept for 10 minutes (kv 'stats:<key>'), so an open dashboard costs almost nothing. The
 * nightly cron stores a snapshot per hospital and for the site (stats_daily), the only record of how
 * many people were active on a given day.
 */

import { json } from './lib.js';
import { currentStage, getStageMonth } from './profile.js';

const DAY = 86400000;
const IRAQ = 3 * 3600000;
const CACHE_MS = 10 * 60 * 1000;
const HOSP_RE = /^[\w-]{1,48}$/;
/** Iraq calendar day of a ms timestamp column, in SQL. */
const dayOf = col => `date((${col} + ${IRAQ}) / 1000, 'unixepoch')`;
const RESIDENT_ROLES = "('user', 'anaesthesia', 'admin')";
/** Feature adoption counts the people whose accounts are active today (out of the active accounts). */
const ACTIVE = "(SELECT id FROM accounts WHERE status = 'active')";
/** Resident ids held by active accounts: one pass over the accounts (a per-resident lookup read them all again for each resident). */
const LINKED = "(SELECT resident_id FROM accounts WHERE status = 'active' AND resident_id IS NOT NULL)";

const seesAll = auth => auth.r === 'owner' || (auth.h || []).includes('*');

export async function routeStats(path, method, env, auth, url) {
  if (!/^\/api\/stats(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (method === 'GET' && path === '/api/stats/summary') return summary(env, auth, url);
  if (method === 'GET' && path === '/api/stats/growth') return auth.r === 'owner' ? growth(env, url) : json({ error: 'forbidden' }, 403);
  return json({ error: 'not_found' }, 404);
}

async function cached(env, key, build) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('stats:' + key).first().catch(() => null);
  if (row) {
    try { const c = JSON.parse(row.v); if (now - c.at < CACHE_MS) return json({ ...c.body, cached: true }); } catch {}
  }
  const body = await build(now);
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind('stats:' + key, JSON.stringify({ at: now, body })).run().catch(() => {});
  return json(body);
}

async function summary(env, auth, url) {
  const asked = String(url.searchParams.get('h') || '');
  let h;
  if (auth.r === 'owner') h = asked === '*' || HOSP_RE.test(asked) ? asked : '*';
  else if (auth.r === 'admin') {
    const mine = (auth.h || []).filter(x => x !== '*');
    h = asked && asked !== '*' && (seesAll(auth) || mine.includes(asked)) ? asked : mine[0] || (seesAll(auth) ? '*' : '');
    if (!h) return json({ error: 'forbidden' }, 403);
  } else return json({ error: 'forbidden' }, 403);
  return cached(env, 'sum:' + h, now => buildSummary(env, h, now));
}

async function buildSummary(env, h, now) {
  const d1 = now - DAY, d7 = now - 7 * DAY, d30 = now - 30 * DAY, d60 = now - 60 * DAY;
  const all = h === '*' ? 1 : 0;
  const inHosp = `EXISTS (SELECT 1 FROM json_each(r.data, '$.hospitals') x WHERE x.value = ?1)`;
  const [acc, res, act, feat, series] = await env.DB.batch([
    env.DB.prepare(
      `SELECT role, status, COUNT(*) AS n, SUM(created_at >= ?3) AS new7, SUM(created_at >= ?4) AS new30,
              SUM(last_seen >= ?5) AS dau, SUM(last_seen >= ?3) AS wau, SUM(last_seen >= ?4) AS mau
         FROM accounts WHERE (?2 = 1 OR hosp = ?1) GROUP BY role, status`
    ).bind(h, all, d7, d30, d1),
    env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(COALESCE(json_extract(r.data, '$.active'), 1) != 0) AS active,
              SUM(r.id IN ${LINKED}) AS linked
         FROM records r WHERE r.coll = 'resident' AND (?2 = 1 OR ${inHosp})`
    ).bind(h, all),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM comments WHERE deleted = 0 AND ts >= ?3 AND (?2 = 1 OR hosp = ?1)) AS comments,
         (SELECT COUNT(*) FROM comments WHERE deleted = 0 AND ts >= ?4 AND ts < ?3 AND (?2 = 1 OR hosp = ?1)) AS comments_prev,
         (SELECT COUNT(*) FROM likes WHERE ts >= ?3 AND (?2 = 1 OR target LIKE 'duty:' || ?1 || ':%')) AS likes,
         (SELECT COUNT(*) FROM likes WHERE ts >= ?4 AND ts < ?3 AND (?2 = 1 OR target LIKE 'duty:' || ?1 || ':%')) AS likes_prev,
         (SELECT COUNT(*) FROM contact_requests WHERE created_at >= ?3 AND (?2 = 1 OR hosp = ?1)) AS contacts,
         (SELECT COUNT(*) FROM contact_requests WHERE created_at >= ?4 AND created_at < ?3 AND (?2 = 1 OR hosp = ?1)) AS contacts_prev,
         (SELECT COUNT(*) FROM duty_status WHERE updated_at >= ?3 AND (?2 = 1 OR hosp = ?1)) AS statuses,
         (SELECT COUNT(*) FROM duty_status WHERE updated_at >= ?4 AND updated_at < ?3 AND (?2 = 1 OR hosp = ?1)) AS statuses_prev,
         (SELECT COUNT(*) FROM exchange_requests WHERE created_at >= ?3 AND (?2 = 1 OR hosp = ?1)) AS exchanges,
         (SELECT COUNT(*) FROM exchange_requests WHERE created_at >= ?4 AND created_at < ?3 AND (?2 = 1 OR hosp = ?1)) AS exchanges_prev,
         (SELECT COUNT(*) FROM opioid_moves m JOIN opioid_duties d ON d.id = m.duty_id
           WHERE m.kind = 'use' AND m.voided_at IS NULL AND m.created_at >= ?3 AND (?2 = 1 OR d.hosp = ?1)) AS opioids,
         (SELECT COUNT(*) FROM opioid_moves m JOIN opioid_duties d ON d.id = m.duty_id
           WHERE m.kind = 'use' AND m.voided_at IS NULL AND m.created_at >= ?4 AND m.created_at < ?3 AND (?2 = 1 OR d.hosp = ?1)) AS opioids_prev`
    ).bind(h, all, d30, d60),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT p.account_id) FROM push_subs p JOIN accounts a ON a.id = p.account_id WHERE a.status = 'active' AND (?2 = 1 OR a.hosp = ?1)) AS push,
         (SELECT COUNT(*) FROM duty_reminders r JOIN accounts a ON a.id = r.account_id WHERE a.status = 'active' AND (?2 = 1 OR a.hosp = ?1)) AS reminders,
         (SELECT COUNT(*) FROM accounts WHERE status = 'active' AND avatar IS NOT NULL AND avatar <> '' AND (?2 = 1 OR hosp = ?1)) AS avatars,
         (SELECT COUNT(*) FROM accounts WHERE status = 'active' AND role IN ${RESIDENT_ROLES} AND board IS NOT NULL AND stage IS NOT NULL AND (?2 = 1 OR hosp = ?1)) AS profiles,
         (SELECT COUNT(*) FROM accounts WHERE status = 'active' AND role IN ${RESIDENT_ROLES} AND (?2 = 1 OR hosp = ?1)) AS residentAccounts`
    ).bind(h, all),
    env.DB.prepare(
      `SELECT d, k, COUNT(*) AS n FROM (
         SELECT ${dayOf('ts')} AS d, 'i' AS k FROM comments WHERE deleted = 0 AND ts >= ?3 AND (?2 = 1 OR hosp = ?1)
         UNION ALL SELECT ${dayOf('ts')}, 'i' FROM likes WHERE ts >= ?3 AND (?2 = 1 OR target LIKE 'duty:' || ?1 || ':%')
         UNION ALL SELECT ${dayOf('created_at')}, 'i' FROM contact_requests WHERE created_at >= ?3 AND (?2 = 1 OR hosp = ?1)
         UNION ALL SELECT ${dayOf('updated_at')}, 'i' FROM duty_status WHERE updated_at >= ?3 AND (?2 = 1 OR hosp = ?1)
         UNION ALL SELECT ${dayOf('created_at')}, 's' FROM accounts WHERE created_at >= ?3 AND (?2 = 1 OR hosp = ?1)
       ) GROUP BY d, k`
    ).bind(h, all, d30),
  ]);
  const accounts = { active: 0, pending: 0, disabled: 0, new7: 0, new30: 0, dau: 0, wau: 0, mau: 0, roles: {} };
  for (const r of acc.results || []) {
    if (r.status === 'active') {
      accounts.active += r.n; accounts.dau += r.dau || 0; accounts.wau += r.wau || 0; accounts.mau += r.mau || 0;
      accounts.roles[r.role] = (accounts.roles[r.role] || 0) + r.n;
    } else if (r.status === 'pending') accounts.pending += r.n;
    else if (r.status === 'disabled') accounts.disabled += r.n;
    if (r.status === 'active' || r.status === 'pending') { accounts.new7 += r.new7 || 0; accounts.new30 += r.new30 || 0; }
  }
  const resRow = (res.results || [])[0] || {};
  const a = (act.results || [])[0] || {};
  const pair = k => ({ now: a[k] || 0, prev: a[k + '_prev'] || 0 });
  const days = [];
  for (let t = now - 29 * DAY; t <= now; t += DAY) days.push(new Date(t + IRAQ).toISOString().slice(0, 10));
  const pick = k => days.map(d => ((series.results || []).find(r => r.d === d && r.k === k) || {}).n || 0);
  return {
    ok: true, scope: h, at: now,
    accounts,
    residents: { total: resRow.total || 0, active: resRow.active || 0, linked: resRow.linked || 0 },
    activity: { comments: pair('comments'), likes: pair('likes'), contacts: pair('contacts'), statuses: pair('statuses'), exchanges: pair('exchanges'), opioids: pair('opioids') },
    features: (feat.results || [])[0] || {},
    series: { days, interactions: pick('i'), signups: pick('s') },
    hospitals: all ? await perHospital(env, now) : undefined,
  };
}

/** The hospitals side by side (the owner's whole-site views). */
async function perHospital(env, now) {
  const d30 = now - 30 * DAY;
  const [names, acc, res, com, con] = await env.DB.batch([
    env.DB.prepare("SELECT id, COALESCE(json_extract(data, '$.name_ar'), json_extract(data, '$.hospitalName'), id) AS name FROM records WHERE coll = 'hospital'"),
    env.DB.prepare(
      `SELECT hosp, SUM(status = 'active') AS active, SUM(status = 'pending') AS pending, SUM(status = 'active' AND last_seen >= ?1) AS mau,
              SUM(status = 'active' AND last_seen >= ?2) AS wau FROM accounts GROUP BY hosp`
    ).bind(d30, now - 7 * DAY),
    env.DB.prepare(
      `SELECT x.value AS hosp, COUNT(*) AS total,
              SUM(r.id IN ${LINKED}) AS linked
         FROM records r, json_each(r.data, '$.hospitals') x
        WHERE r.coll = 'resident' AND COALESCE(json_extract(r.data, '$.active'), 1) != 0 GROUP BY x.value`
    ),
    env.DB.prepare('SELECT hosp, COUNT(*) AS n FROM comments WHERE deleted = 0 AND ts >= ? GROUP BY hosp').bind(d30),
    env.DB.prepare('SELECT hosp, COUNT(*) AS n FROM contact_requests WHERE created_at >= ? GROUP BY hosp').bind(d30),
  ]);
  const by = (rows, id) => (rows.results || []).find(r => r.hosp === id) || {};
  return (names.results || []).map(x => ({
    id: x.id, name: x.name,
    active: by(acc, x.id).active || 0, pending: by(acc, x.id).pending || 0, wau: by(acc, x.id).wau || 0, mau: by(acc, x.id).mau || 0,
    residents: by(res, x.id).total || 0, linked: by(res, x.id).linked || 0,
    comments: by(com, x.id).n || 0, contacts: by(con, x.id).n || 0,
  })).sort((p, q) => q.active - p.active);
}

async function growth(env, url) {
  const days = Math.max(14, Math.min(365, Number(url.searchParams.get('days')) || 90));
  return cached(env, 'growth:' + days, now => buildGrowth(env, days, now));
}

async function buildGrowth(env, days, now) {
  const from = now - (days - 1) * DAY;
  const start = new Date(from + IRAQ).toISOString().slice(0, 10);
  const from90 = now - 90 * DAY;
  // One grouped query per kind (D1 allows only a few terms in a compound SELECT).
  const KINDS = [
    ['signups', 'accounts', 'created_at', "status IN ('active', 'pending', 'disabled')"],
    ['comments', 'comments', 'ts', 'deleted = 0'],
    ['likes', 'likes', 'ts', '1'],
    ['contacts', 'contact_requests', 'created_at', '1'],
    ['statuses', 'duty_status', 'updated_at', '1'],
    ['exchanges', 'exchange_requests', 'created_at', '1'],
    ['opioids', 'opioid_moves', 'created_at', "kind = 'use' AND voided_at IS NULL"],
    ['edits', 'audit', 'ts', '1'],
  ];
  const results = await env.DB.batch([
    ...KINDS.map(([, table, col, where]) => env.DB.prepare(
      `SELECT ${dayOf(col)} AS d, COUNT(*) AS n FROM ${table} WHERE ${col} >= ?1 AND ${where} GROUP BY d`).bind(from)),
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE created_at < ? AND status IN ('active', 'pending', 'disabled')").bind(from),
    env.DB.prepare("SELECT day, data FROM stats_daily WHERE scope = '*' AND day >= ? ORDER BY day").bind(start),
    env.DB.prepare(
      `SELECT CAST(strftime('%w', (t + ${IRAQ}) / 1000, 'unixepoch') AS INTEGER) AS wd, CAST(strftime('%H', (t + ${IRAQ}) / 1000, 'unixepoch') AS INTEGER) AS hr, COUNT(*) AS n FROM (
         SELECT ts AS t FROM comments WHERE ts >= ?1 UNION ALL SELECT ts FROM likes WHERE ts >= ?1
         UNION ALL SELECT created_at FROM contact_requests WHERE created_at >= ?1 UNION ALL SELECT updated_at FROM duty_status WHERE updated_at >= ?1
         UNION ALL SELECT ts FROM audit WHERE ts >= ?1
       ) GROUP BY wd, hr`
    ).bind(from90),
    env.DB.prepare('SELECT label, COUNT(*) AS n FROM account_devices WHERE last_seen >= ? GROUP BY label').bind(from90),
    env.DB.prepare(
      `SELECT role, sex, anon_lang AS lang, board, stage, stage_ref, board_years, last_seen, created_at, hosp,
              (avatar IS NOT NULL AND avatar <> '') AS avatar FROM accounts WHERE status = 'active'`
    ),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT p.account_id) FROM push_subs p JOIN accounts a ON a.id = p.account_id WHERE a.status = 'active') AS push,
         (SELECT COUNT(*) FROM duty_reminders r JOIN accounts a ON a.id = r.account_id WHERE a.status = 'active') AS reminders,
         (SELECT COUNT(DISTINCT account_id) FROM comments WHERE deleted = 0 AND ts >= ?1 AND account_id IN ${ACTIVE}) AS commenters,
         (SELECT COUNT(DISTINCT account_id) FROM likes WHERE ts >= ?1 AND account_id IN ${ACTIVE}) AS likers,
         (SELECT COUNT(DISTINCT requester_id) FROM contact_requests WHERE created_at >= ?1 AND requester_id IN ${ACTIVE}) AS requesters,
         (SELECT COUNT(DISTINCT account_id) FROM duty_status WHERE updated_at >= ?1 AND account_id IN ${ACTIVE}) AS statusSetters,
         (SELECT COUNT(DISTINCT requester_id) FROM exchange_requests WHERE created_at >= ?1 AND requester_id IN ${ACTIVE}) AS exchangers,
         (SELECT COUNT(DISTINCT by_id) FROM opioid_moves WHERE created_at >= ?1 AND by_id IN ${ACTIVE}) AS opioidUsers,
         (SELECT COUNT(*) FROM comments WHERE deleted = 0 AND anon = 1 AND ts >= ?1) AS anonComments,
         (SELECT COUNT(*) FROM comments WHERE deleted = 0 AND ts >= ?1) AS allComments`
    ).bind(from90),
    env.DB.prepare('SELECT type, COUNT(*) AS n FROM notifications WHERE ts >= ? GROUP BY type ORDER BY n DESC LIMIT 15').bind(now - 30 * DAY),
  ]);
  const daily = results.slice(0, KINDS.length);
  const [base, snaps, hours, devices, accts, adoption, notes] = results.slice(KINDS.length);
  const dayList = [];
  for (let t = from; t <= now; t += DAY) dayList.push(new Date(t + IRAQ).toISOString().slice(0, 10));
  const series = {};
  KINDS.forEach(([k], i) => { series[k] = Object.fromEntries((daily[i].results || []).map(r => [r.d, r.n])); });
  const month = await getStageMonth(env);
  const rows = accts.results || [];
  const count = f => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const ago = r => (r.last_seen ? now - r.last_seen : Infinity);
  return {
    ok: true, at: now, days: dayList,
    series: Object.fromEntries(['signups', 'comments', 'likes', 'contacts', 'statuses', 'exchanges', 'opioids', 'edits']
      .map(k => [k, dayList.map(d => (series[k] || {})[d] || 0)])),
    accountsBefore: (base.results[0] || {}).n || 0,
    snapshots: (snaps.results || []).map(r => { try { return { day: r.day, ...JSON.parse(r.data) }; } catch { return { day: r.day }; } }),
    hours: hours.results || [],
    devices: devices.results || [],
    breakdown: {
      roles: count(r => r.role), sex: count(r => r.sex || 'unknown'), lang: count(r => r.lang || 'ar'),
      boards: count(r => (['user', 'anaesthesia', 'admin'].includes(r.role) ? r.board || 'unset' : 'n/a')),
      stages: count(r => (['user', 'anaesthesia', 'admin'].includes(r.role) ? String(currentStage(r.stage, r.stage_ref, r.board_years, month) ?? 'unset') : 'n/a')),
      recency: count(r => { const t = ago(r); return t <= DAY ? 'd1' : t <= 7 * DAY ? 'd7' : t <= 30 * DAY ? 'd30' : t <= 90 * DAY ? 'd90' : 'older'; }),
      avatars: rows.filter(r => r.avatar).length, total: rows.length,
    },
    adoption: (adoption.results || [])[0] || {},
    notifications: notes.results || [],
    hospitals: await perHospital(env, now),
  };
}

/** Nightly (cron): the day's snapshot for the site and each hospital. */
export async function snapshotStats(env) {
  const now = Date.now();
  const day = new Date(now + IRAQ - 12 * 3600000).toISOString().slice(0, 10); // the Iraq day that just ended
  const d1 = now - DAY, d7 = now - 7 * DAY, d30 = now - 30 * DAY;
  const [acc, inter] = await env.DB.batch([
    env.DB.prepare(
      `SELECT hosp, SUM(status = 'active') AS accounts, SUM(status = 'pending') AS pending,
              SUM(status = 'active' AND last_seen >= ?1) AS dau, SUM(status = 'active' AND last_seen >= ?2) AS wau,
              SUM(status = 'active' AND last_seen >= ?3) AS mau, SUM(created_at >= ?1) AS signups FROM accounts GROUP BY hosp`
    ).bind(d1, d7, d30),
    env.DB.prepare(
      `SELECT hosp, COUNT(*) AS n FROM (
         SELECT hosp FROM comments WHERE ts >= ?1 AND deleted = 0
         UNION ALL SELECT substr(target, 6, instr(substr(target, 6), ':') - 1) FROM likes WHERE ts >= ?1 AND target LIKE 'duty:%'
         UNION ALL SELECT hosp FROM contact_requests WHERE created_at >= ?1
         UNION ALL SELECT hosp FROM duty_status WHERE updated_at >= ?1
       ) GROUP BY hosp`
    ).bind(d1),
  ]);
  const site = { accounts: 0, pending: 0, dau: 0, wau: 0, mau: 0, signups: 0, interactions: 0 };
  const per = new Map();
  for (const r of acc.results || []) {
    const v = { accounts: r.accounts || 0, pending: r.pending || 0, dau: r.dau || 0, wau: r.wau || 0, mau: r.mau || 0, signups: r.signups || 0, interactions: 0 };
    per.set(r.hosp, v);
    for (const k of Object.keys(site)) site[k] += v[k] || 0;
  }
  for (const r of inter.results || []) {
    if (!r.hosp) continue;
    const v = per.get(r.hosp) || { accounts: 0, pending: 0, dau: 0, wau: 0, mau: 0, signups: 0, interactions: 0 };
    v.interactions = r.n;
    per.set(r.hosp, v);
    site.interactions += r.n;
  }
  const stmts = [env.DB.prepare('INSERT INTO stats_daily (day, scope, data) VALUES (?, ?, ?) ON CONFLICT (day, scope) DO UPDATE SET data = excluded.data').bind(day, '*', JSON.stringify(site))];
  for (const [hosp, v] of per) {
    if (HOSP_RE.test(String(hosp || ''))) stmts.push(env.DB.prepare('INSERT INTO stats_daily (day, scope, data) VALUES (?, ?, ?) ON CONFLICT (day, scope) DO UPDATE SET data = excluded.data').bind(day, hosp, JSON.stringify(v)));
  }
  await env.DB.batch(stmts);
  return { day, scopes: stmts.length };
}
