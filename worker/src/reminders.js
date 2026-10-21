/**
 * Duty reminders: a resident switches them on in "My Schedule" and picks how long before each duty
 * the notification comes (5 minutes to 3 days).
 *
 * The coming reminders of an account are kept in duty_reminder_queue, rebuilt from the schedules
 * (the same collection as My Schedule) when the resident saves the setting, opens My Schedule on
 * the current month, every few hours by the cron, and once more just before sending (so a duty that
 * was exchanged or removed is not announced). The live Worker's cron sends what is due.
 */

import { DAY, json, readJson, plainText } from './lib.js';
import { collectDuties, erDutyPlan, hospitalTimes, dutyStartUtc } from './duties.js';
import { notifyOne, dispatchPush } from './accounts.js';

export const LEAD_MIN = 5;
export const LEAD_MAX = 3 * 24 * 60;
const NOT_RESIDENT = ['rotator', 'aa_user', 'aa_admin'];
const STALE_MS = 6 * 3600 * 1000;      // the cron rebuilds a queue older than this
const REFRESH_PER_TICK = 2;            // queues rebuilt per cron run (CPU budget)
const SEND_PER_TICK = 6;               // accounts notified per cron run (the rest wait for the next run)
const ACCOUNT_FIELDS = 'id, name, name_key, hosp, phone, resident_id, role, status';

const pad2 = n => String(n).padStart(2, '0');
/** YYYY-MM in Iraq (UTC+3), `k` months from now. */
function iraqYm(now, k = 0) {
  const d = new Date(now + 3 * 3600 * 1000);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
  return `${m.getUTCFullYear()}-${pad2(m.getUTCMonth() + 1)}`;
}

/** Start time (ms) and title of one My Schedule duty. */
export function dutyPlan(d, names) {
  let h, min = 0, title;
  if (d.src === 'hospital') {
    [h, min] = hospitalTimes(d.time);
    title = (names && names[d.spec]) || d.spec || 'خفارة المستشفى';
  } else {
    ({ title, h, min } = erDutyPlan(d));
  }
  return { start: dutyStartUtc(d.date, h, min), title };
}

/** The queue rows for `duties` (only duties that have not started yet). */
export function plannedReminders(duties, leadMin, names, now) {
  const out = [];
  for (const d of duties) {
    const { start, title } = dutyPlan(d, names);
    if (start <= now) continue;
    out.push({ dkey: d.key, start, fire: start - leadMin * 60000, title, hosp: d.hosp || null });
  }
  return out;
}

/** "ساعتين و30 دقيقة": a duration in minutes, in words. */
export function durationText(min) {
  const days = Math.floor(min / 1440), hours = Math.floor((min % 1440) / 60), mins = min % 60;
  const unit = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
  const parts = [];
  if (days) parts.push(unit(days, 'يوم', 'يومين', 'أيام', 'يوماً'));
  if (hours) parts.push(unit(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة'));
  if (mins) parts.push(unit(mins, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'));
  return parts.join(' و') || 'دقيقة';
}

const loadSetting = (env, id) => env.DB.prepare('SELECT lead_min, names, synced_at FROM duty_reminders WHERE account_id = ?').bind(id).first();
const parseNames = s => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/**
 * Rebuilds an account's queue from its duties. `months` are { ym: collectDuties result } already at
 * hand; the months still missing (this one, and the next near the month's end) are collected here.
 */
export async function rebuildQueue(env, acc, setting, now, months = {}) {
  const lead = setting.lead_min;
  const wanted = [iraqYm(now)];
  // Near the month's end the next month's first duties fall inside the reminder window.
  const iraqDay = new Date(now + 3 * 3600 * 1000).getUTCDate();
  const daysLeft = new Date(Date.UTC(Number(wanted[0].slice(0, 4)), Number(wanted[0].slice(5)), 0)).getUTCDate() - iraqDay;
  if (daysLeft <= 2 + Math.ceil(lead / 1440)) wanted.push(iraqYm(now, 1));
  const duties = [];
  for (const ym of wanted) {
    const data = months[ym] || await collectDuties(env, acc, ym);
    duties.push(...(data.duties || []));
  }
  const rows = plannedReminders(duties, lead, parseNames(setting.names), now);
  const stmts = [
    // Duties that are gone (exchanged, removed) or over.
    env.DB.prepare(`DELETE FROM duty_reminder_queue WHERE account_id = ?1 AND dkey NOT IN (SELECT value FROM json_each(?2))`)
      .bind(acc.id, JSON.stringify(rows.map(r => r.dkey))),
    ...rows.map(r => env.DB.prepare(
      `INSERT INTO duty_reminder_queue (account_id, dkey, fire_at, start_at, title, hosp, sent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
       ON CONFLICT (account_id, dkey) DO UPDATE SET title = excluded.title, hosp = excluded.hosp,
         sent = CASE WHEN duty_reminder_queue.fire_at = excluded.fire_at THEN duty_reminder_queue.sent ELSE 0 END,
         fire_at = excluded.fire_at, start_at = excluded.start_at`
    ).bind(acc.id, r.dkey, r.fire, r.start, plainText(r.title, 80), r.hosp)),
    env.DB.prepare('UPDATE duty_reminders SET synced_at = ? WHERE account_id = ?').bind(now, acc.id),
  ];
  await env.DB.batch(stmts);
  return rows;
}

/** My Schedule just collected `data` for the account: refresh its queue when reminders are on (current month only). */
export async function refreshFromMyDuties(env, acc, data, ym) {
  const now = Date.now();
  if (ym !== iraqYm(now)) return;
  const setting = await loadSetting(env, acc.id);
  if (setting) await rebuildQueue(env, acc, setting, now, { [ym]: data });
}

// ---------------------------------------------------------------------------
// API: GET / POST /api/accounts/duty-reminder
// ---------------------------------------------------------------------------

export async function routeReminders(path, method, request, env, auth) {
  if (path !== '/api/accounts/duty-reminder') return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (NOT_RESIDENT.includes(auth.r)) return json({ error: 'residents_only' }, 403);
  if (method === 'GET') return reminderStatus(env, auth.a);
  if (method === 'POST') return saveReminder(request, env, auth);
  return json({ error: 'not_found' }, 404);
}

async function reminderStatus(env, id) {
  const now = Date.now();
  const [setting, next] = await Promise.all([
    loadSetting(env, id),
    env.DB.prepare('SELECT title, start_at, fire_at, sent FROM duty_reminder_queue WHERE account_id = ? AND start_at > ? ORDER BY start_at LIMIT 1').bind(id, now).first(),
  ]);
  return json({
    ok: true, on: !!setting, lead: setting ? setting.lead_min : null,
    next: setting && next ? { title: next.title, start: next.start_at, fire: next.fire_at, sent: !!next.sent } : null,
  });
}

/** Body: { on: boolean, lead: minutes, names: { dutyCode: name } } */
async function saveReminder(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  if (!body.on) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM duty_reminders WHERE account_id = ?').bind(auth.a),
      env.DB.prepare('DELETE FROM duty_reminder_queue WHERE account_id = ?').bind(auth.a),
    ]);
    return json({ ok: true, on: false, lead: null, next: null });
  }
  const lead = Math.floor(Number(body.lead));
  if (!(lead >= LEAD_MIN && lead <= LEAD_MAX)) return json({ error: 'bad_lead' }, 400);
  const names = {};
  if (body.names && typeof body.names === 'object') {
    for (const [k, v] of Object.entries(body.names).slice(0, 150)) names[String(k).slice(0, 40)] = plainText(v, 80);
  }
  const acc = await env.DB.prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE id = ?`).bind(auth.a).first();
  if (!acc) return json({ error: 'account_required' }, 403);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO duty_reminders (account_id, lead_min, names, synced_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4)
     ON CONFLICT (account_id) DO UPDATE SET lead_min = excluded.lead_min, names = excluded.names, updated_at = excluded.updated_at`
  ).bind(auth.a, lead, JSON.stringify(names), now).run();
  // A changed lead time must not announce the duties whose new reminder time has already passed.
  await rebuildQueue(env, acc, { lead_min: lead, names: JSON.stringify(names) }, now);
  await env.DB.prepare('UPDATE duty_reminder_queue SET sent = 1 WHERE account_id = ? AND fire_at <= ? AND sent = 0').bind(auth.a, now).run();
  return reminderStatus(env, auth.a);
}

// ---------------------------------------------------------------------------
// Cron (live Worker, every 10 minutes)
// ---------------------------------------------------------------------------

export async function runReminders(env, ctx, now = Date.now()) {
  // Over or long-past rows.
  await env.DB.prepare('DELETE FROM duty_reminder_queue WHERE start_at < ?').bind(now - DAY).run();
  // Accounts with a reminder due: rebuild their queue first (the duty may have moved), then send.
  const { results: due } = await env.DB.prepare(
    `SELECT DISTINCT q.account_id AS id FROM duty_reminder_queue q JOIN duty_reminders r ON r.account_id = q.account_id
      WHERE q.sent = 0 AND q.fire_at <= ?1 AND q.start_at > ?1 LIMIT ?2`
  ).bind(now, SEND_PER_TICK).all();
  const rebuilt = new Set();
  for (const { id } of due || []) {
    try {
      const acc = await env.DB.prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE id = ?`).bind(id).first();
      const setting = await loadSetting(env, id);
      if (!acc || acc.status !== 'active' || NOT_RESIDENT.includes(acc.role)) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM duty_reminders WHERE account_id = ?').bind(id),
          env.DB.prepare('DELETE FROM duty_reminder_queue WHERE account_id = ?').bind(id),
        ]);
        continue;
      }
      await rebuildQueue(env, acc, setting, now);
      rebuilt.add(id);
      await sendDue(env, ctx, acc, setting, now);
    } catch (err) {
      console.error('duty reminder', id, err && err.stack || err);
    }
  }
  // A few stale queues per run pick up duties added since the last rebuild.
  const { results: stale } = await env.DB.prepare(
    'SELECT account_id AS id, lead_min, names FROM duty_reminders WHERE synced_at < ? ORDER BY synced_at LIMIT ?'
  ).bind(now - STALE_MS, REFRESH_PER_TICK + rebuilt.size).all();
  for (const s of (stale || []).filter(s => !rebuilt.has(s.id)).slice(0, REFRESH_PER_TICK)) {
    try {
      const acc = await env.DB.prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE id = ?`).bind(s.id).first();
      if (!acc || acc.status !== 'active') {
        await env.DB.prepare('UPDATE duty_reminders SET synced_at = ? WHERE account_id = ?').bind(now, s.id).run();
        continue;
      }
      await rebuildQueue(env, acc, s, now);
    } catch (err) {
      console.error('duty reminder refresh', s.id, err && err.stack || err);
    }
  }
}

async function sendDue(env, ctx, acc, setting, now) {
  const { results: rows } = await env.DB.prepare(
    `SELECT q.dkey, q.start_at, q.title, q.hosp,
            (SELECT COALESCE(json_extract(data, '$.name_ar'), json_extract(data, '$.hospitalName')) FROM records WHERE coll = 'hospital' AND id = q.hosp) AS hosp_name
       FROM duty_reminder_queue q WHERE q.account_id = ?1 AND q.sent = 0 AND q.fire_at <= ?2 AND q.start_at > ?2 ORDER BY q.start_at`
  ).bind(acc.id, now).all();
  if (!rows || !rows.length) return;
  const stmts = [];
  for (const r of rows) {
    const data = JSON.stringify({
      title: r.title, start: r.start_at, in: Math.max(1, Math.round((r.start_at - now) / 60000)),
      lead: setting.lead_min, h: r.hosp, hospName: r.hosp && r.hosp !== acc.hosp ? r.hosp_name : null, key: r.dkey,
    });
    stmts.push(notifyOne(env, acc.id, 'duty:' + r.dkey, 'duty_reminder', data, now));
  }
  stmts.push(env.DB.prepare('UPDATE duty_reminder_queue SET sent = 1 WHERE account_id = ? AND dkey IN (SELECT value FROM json_each(?))')
    .bind(acc.id, JSON.stringify(rows.map(r => r.dkey))));
  const results = await env.DB.batch(stmts);
  dispatchPush(env, ctx, ...results.slice(0, rows.length));
}
