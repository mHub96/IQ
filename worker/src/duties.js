/**
 * "My Schedule" and the ER preferences portal.
 *
 * My Schedule: a resident's duties for one month, collected from their hospital's roster
 * (`sched` records) and from the ER scheduler's month record, plus their own marks on each duty
 * (bought / sold, a flag with a reason, a note).
 *
 * ER portal: an admin opens a window in which the residents of a hospital send their ER duty
 * preferences for a coming month. Requests are kept in er_pref_requests; the ER page copies them
 * into its residents database when an admin opens that month (the server never rewrites the ER
 * scheduler's shared record, which the ER page saves as a whole).
 *
 * JSON work on the large ER record is done by SQLite (json_each / json_extract), not by the
 * Worker, to stay inside the free plan's CPU budget.
 */

import { DAY, json, readJson, overLimit, plainText } from './lib.js';
import { nameKey, nameTokens, namesMatch, phoneKey, isoDate } from './names.js';
import { notifyHospitalResidents, dispatchPush } from './accounts.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const YM_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const ER_STATE_ID = 'hosp_hub_emergency_state_v3';
const KINDS = ['bought', 'sold'];
export const FLAGS = ['swap', 'leave', 'sick', 'exam', 'course', 'cover', 'important', 'other'];
const SHIFTS = ['morning', 'afternoon', 'preNight', 'lateNight'];
const WEEKDAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const MAX_PORTAL_DAYS = 45;

// ER month record layout (see emergency.js): which fields of each day row hold a doctor's name.
const ER_SLOTS = {
  er: ['morning', 'afternoon', 'preNight', 'lateNight'],
  con: ['doctor'],
  dc: ['doctor'],
  rs: ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight', 'ward_private', 'ward_floor4', 'ward_floor5'],
};

/** Routes under /api/accounts/my-duties, /api/accounts/duty-mark and /api/er-portal. Null when not matched. */
export async function routeDuties(path, method, request, env, auth, url, ctx) {
  if (!/^\/api\/(accounts\/(my-duties|duty-mark)|er-portal)(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/accounts/my-duties': return myDuties(env, auth, url);
    case 'POST /api/accounts/duty-mark': return saveMark(request, env, auth);
    case 'GET /api/er-portal/mine': return portalMine(env, auth);
    case 'POST /api/er-portal/mine': return savePortalRequest(request, env, auth);
    case 'GET /api/er-portal': return portalAdmin(env, auth, url);
    case 'POST /api/er-portal/open': return openPortal(request, env, auth, ctx);
    case 'POST /api/er-portal/close': return closePortal(request, env, auth);
    case 'POST /api/er-portal/applied': return markApplied(request, env, auth);
  }
  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------------
// Matching an account to the ER residents database
// ---------------------------------------------------------------------------

const erPath = hosp => `$.hospitalResidents."${hosp}"`;

/** The account's entry in the ER residents database of its hospital: by phone, then by name. */
async function findErResident(env, account) {
  if (!HOSP_RE.test(account.hosp || '')) return null;
  const list = async path => (await env.DB.prepare(
    `SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.name') AS name,
            json_extract(j.value, '$.sex') AS sex, json_extract(j.value, '$.phone') AS phone
       FROM records r, json_each(r.data, ?1) j
      WHERE r.coll = 'er' AND r.id = ?2`
  ).bind(path, ER_STATE_ID).all()).results || [];
  let path = erPath(account.hosp);
  let rows = await list(path);
  if (!rows.length) {
    // An ER database that was never switched to another hospital keeps its residents in $.residents.
    const cur = await env.DB.prepare("SELECT json_extract(data, '$.hospitalId') AS h FROM records WHERE coll = 'er' AND id = ?").bind(ER_STATE_ID).first();
    if (cur && cur.h === account.hosp) { path = '$.residents'; rows = await list(path); }
  }
  const match = pickResident(rows, account);
  if (!match) return null;
  const full = await env.DB.prepare(
    `SELECT j.value AS v FROM records r, json_each(r.data, ?1) j
      WHERE r.coll = 'er' AND r.id = ?2 AND json_extract(j.value, '$.id') = ?3`
  ).bind(path, ER_STATE_ID, match.id).first();
  let res = {};
  try { res = JSON.parse(full ? full.v : '{}'); } catch {}
  return { id: match.id, name: match.name, sex: match.sex === 'F' ? 'f' : match.sex === 'M' ? 'm' : null, prefs: cleanPrefs(res, null, true) };
}

export function pickResident(rows, account) {
  const pk = phoneKey(account.phone);
  if (pk) {
    const byPhone = rows.find(r => phoneKey(r.phone) === pk);
    if (byPhone) return byPhone;
  }
  const key = nameKey(account.name);
  const exact = rows.filter(r => nameKey(r.name) === key);
  if (exact.length === 1) return exact[0];
  // First three names equal (the ER list often adds or drops the fourth name).
  const t = nameTokens(account.name);
  if (t.length >= 3) {
    const three = rows.filter(r => { const s = nameTokens(r.name); return s.length >= 3 && s[0] === t[0] && s[1] === t[1] && s[2] === t[2]; });
    if (three.length === 1) return three[0];
  }
  const loose = rows.filter(r => namesMatch(account.name, r.name) && namesMatch(r.name, account.name));
  return loose.length === 1 ? loose[0] : null;
}

// ---------------------------------------------------------------------------
// My Schedule
// ---------------------------------------------------------------------------

async function myDuties(env, auth, url) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const ym = String(url.searchParams.get('ym') || '');
  const m = ym.match(YM_RE);
  if (!m) return json({ error: 'bad_month' }, 400);
  const year = Number(m[1]), month = Number(m[2]);
  const acc = await env.DB.prepare('SELECT id, name, name_key, hosp, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  if (!acc) return json({ error: 'account_required' }, 403);

  const er = await findErResident(env, acc);
  const keys = new Set([acc.name_key || nameKey(acc.name)]);
  if (er && er.name) keys.add(nameKey(er.name));

  const erId = `hosp_hub_emergency_sched_${acc.hosp}_${year}_${month}`;
  const [rosterRes, erRes, marksRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, json_extract(data, '$.date') AS date, json_extract(data, '$.name') AS name,
              json_extract(data, '$.specCode') AS spec, json_extract(data, '$.dutyTime') AS time,
              json_extract(data, '$.dutySlot') AS slot
         FROM records
        WHERE coll = 'sched' AND hosp = ?1 AND (json_extract(data, '$.date') LIKE ?2 OR json_extract(data, '$.date') LIKE ?3)`
    ).bind(acc.hosp, `%/${String(month).padStart(2, '0')}/${year}`, `%/${month}/${year}`),
    env.DB.prepare(
      `SELECT COALESCE((SELECT data FROM records WHERE coll = 'er' AND id = ?1),
                       (SELECT json_extract(data, ?2) FROM records WHERE coll = 'er' AND id = ?3)) AS data`
    ).bind(erId, `$.monthlySchedules."${acc.hosp}_${year}_${month}"`, ER_STATE_ID),
    env.DB.prepare('SELECT dkey, kind, flag, flag_text, note, updated_at FROM duty_marks WHERE account_id = ?1 AND dkey LIKE ?2')
      .bind(auth.a, `${ym}-%`),
  ]);

  const duties = [];
  for (const r of rosterRes.results || []) {
    if (!keys.has(nameKey(r.name))) continue;
    const date = isoDate(r.date);
    if (!date) continue;
    const slot = Number(r.slot) || 0;
    duties.push({ key: `${date}|h|${r.spec || ''}:${slot}`, date, src: 'hospital', spec: r.spec || '', time: r.time || '', slot });
  }
  let erMonth = null;
  try { erMonth = JSON.parse((erRes.results[0] || {}).data || 'null'); } catch {}
  if (erMonth && typeof erMonth === 'object') {
    for (const [type, fields] of Object.entries(ER_SLOTS)) {
      for (const day of Array.isArray(erMonth[type]) ? erMonth[type] : []) {
        const date = isoDate(day && day.date);
        if (!date || !date.startsWith(ym)) continue;
        for (const f of fields) {
          if (day[f] && keys.has(nameKey(day[f]))) duties.push({ key: `${date}|${type}|${f}`, date, src: 'er', type, slot: f });
        }
      }
    }
  }
  duties.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const marks = {};
  for (const k of marksRes.results || []) marks[k.dkey] = { kind: k.kind, flag: k.flag, flagText: k.flag_text, note: k.note, at: k.updated_at };
  return json({ ok: true, ym, hosp: acc.hosp, name: acc.name, erName: er ? er.name : null, duties, marks });
}

async function saveMark(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'mark:' + auth.a, 120)) return json({ error: 'rate_limited' }, 429);
  const b = await readJson(request) || {};
  const dkey = String(b.dkey || '');
  if (!/^20\d\d-\d\d-\d\d\|(h|er|con|dc|rs)\|[\w:-]{1,40}$/.test(dkey)) return json({ error: 'bad_duty' }, 400);
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  const flag = FLAGS.includes(b.flag) ? b.flag : null;
  const flagText = flag ? plainText(b.flagText, 120) || null : null;
  const note = plainText(b.note, 500) || null;
  if (!kind && !flag && !note) {
    await env.DB.prepare('DELETE FROM duty_marks WHERE account_id = ? AND dkey = ?').bind(auth.a, dkey).run();
    return json({ ok: true, mark: null });
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO duty_marks (account_id, dkey, kind, flag, flag_text, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (account_id, dkey) DO UPDATE SET kind = excluded.kind, flag = excluded.flag, flag_text = excluded.flag_text,
       note = excluded.note, updated_at = excluded.updated_at`
  ).bind(auth.a, dkey, kind, flag, flagText, note, now).run();
  return json({ ok: true, mark: { kind, flag, flagText, note, at: now } });
}

// ---------------------------------------------------------------------------
// Preferences: the same fields the ER page's preferences panel saves
// ---------------------------------------------------------------------------

function daysIn(ym) {
  const m = String(ym || '').match(YM_RE);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() : 31;
}

/** Validated copy of a preferences object. `loose` keeps whatever is valid (reading the ER data). */
export function cleanPrefs(p, ym, loose = false) {
  p = p && typeof p === 'object' ? p : {};
  const uniq = a => [...new Set(a)];
  const max = daysIn(ym);
  const out = {
    prefShifts: uniq((Array.isArray(p.prefShifts) ? p.prefShifts : []).filter(s => SHIFTS.includes(s))),
    prefDays: uniq((Array.isArray(p.prefDays) ? p.prefDays : []).filter(d => WEEKDAYS.includes(d))),
    prefDaysMode: p.prefDaysMode === 'prefer' ? 'prefer' : 'exclude',
    specificDays: uniq((Array.isArray(p.specificDays) ? p.specificDays : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= max)).sort((a, b) => a - b),
    intervalMode: p.intervalMode === 'strictly_within' ? 'strictly_within' : 'exclude',
    excludedIntervals: [],
    noConsecutiveDays: p.noConsecutiveDays !== false,
  };
  for (const iv of (Array.isArray(p.excludedIntervals) ? p.excludedIntervals : []).slice(0, 12)) {
    let s = isoDate(iv && iv.start), e = isoDate(iv && iv.end);
    if (!s && e) s = e;
    if (!e && s) e = s;
    if (!s) continue;
    if (s > e) [s, e] = [e, s];
    out.excludedIntervals.push({ start: s, end: e });
  }
  if (!loose && out.prefShifts.length === SHIFTS.length) out.prefShifts = []; // all shifts = no preference
  return out;
}

// ---------------------------------------------------------------------------
// ER portal
// ---------------------------------------------------------------------------

const canAdmin = (auth, hosp) => auth && (auth.r === 'owner' || (auth.r === 'admin' && (auth.h || []).some(h => h === '*' || h === hosp)));
const isOpen = (p, now = Date.now()) => p && !p.closed_at && p.opens_at <= now && p.closes_at > now;

async function portalMine(env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const acc = await env.DB.prepare('SELECT id, name, hosp, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  const now = Date.now();
  const portal = await env.DB.prepare(
    `SELECT hosp, ym, opens_at, closes_at, closed_at FROM er_portals
      WHERE hosp = ?1 AND closed_at IS NULL AND opens_at <= ?2 AND closes_at > ?2 ORDER BY ym DESC LIMIT 1`
  ).bind(acc.hosp, now).first();
  if (!portal) return json({ ok: true, portal: null });
  const [er, req] = await Promise.all([
    findErResident(env, acc),
    env.DB.prepare('SELECT prefs, updated_at, applied_at FROM er_pref_requests WHERE hosp = ? AND ym = ? AND account_id = ?').bind(portal.hosp, portal.ym, auth.a).first(),
  ]);
  let prefs = null;
  try { prefs = req ? JSON.parse(req.prefs) : null; } catch {}
  return json({
    ok: true,
    portal: { hosp: portal.hosp, ym: portal.ym, closesAt: portal.closes_at, opensAt: portal.opens_at },
    er: er ? { id: er.id, name: er.name, sex: er.sex } : null,
    prefs: prefs || (er ? er.prefs : cleanPrefs({}, portal.ym)),
    request: req ? { at: req.updated_at, applied: !!req.applied_at && req.applied_at >= req.updated_at } : null,
  });
}

async function savePortalRequest(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'erpref:' + auth.a, 60)) return json({ error: 'rate_limited' }, 429);
  const b = await readJson(request) || {};
  const acc = await env.DB.prepare('SELECT id, name, hosp, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  const portal = await env.DB.prepare('SELECT * FROM er_portals WHERE hosp = ? AND ym = ?').bind(acc.hosp, String(b.ym || '')).first();
  if (!isOpen(portal)) return json({ error: 'portal_closed' }, 409);
  const er = await findErResident(env, acc);
  if (!er) return json({ error: 'not_in_er' }, 404);
  const prefs = cleanPrefs(b.prefs, portal.ym);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO er_pref_requests (hosp, ym, account_id, er_id, er_name, name, prefs, updated_at, applied_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
     ON CONFLICT (hosp, ym, account_id) DO UPDATE SET er_id = excluded.er_id, er_name = excluded.er_name, name = excluded.name,
       prefs = excluded.prefs, updated_at = excluded.updated_at, applied_at = NULL`
  ).bind(portal.hosp, portal.ym, auth.a, er.id, er.name, acc.name, JSON.stringify(prefs), now).run();
  return json({ ok: true, prefs, request: { at: now, applied: false } });
}

/** Portals of a hospital (newest first) and the requests of one of them (default: the newest). */
async function portalAdmin(env, auth, url) {
  const hosp = String(url.searchParams.get('hosp') || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_hospital' }, 400);
  if (!canAdmin(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const { results: portals } = await env.DB.prepare(
    'SELECT hosp, ym, opens_at, closes_at, opened_by, closed_at FROM er_portals WHERE hosp = ? ORDER BY ym DESC LIMIT 12'
  ).bind(hosp).all();
  const ym = YM_RE.test(url.searchParams.get('ym') || '') ? url.searchParams.get('ym') : (portals[0] && portals[0].ym);
  let requests = [], accounts = 0;
  if (ym) {
    const [reqs, cnt] = await env.DB.batch([
      env.DB.prepare(
        `SELECT r.account_id, r.er_id, r.er_name, r.name, r.prefs, r.updated_at, r.applied_at, a.username, a.sex
           FROM er_pref_requests r LEFT JOIN accounts a ON a.id = r.account_id
          WHERE r.hosp = ? AND r.ym = ? ORDER BY r.updated_at DESC`
      ).bind(hosp, ym),
      env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE status = 'active' AND hosp = ?").bind(hosp),
    ]);
    requests = (reqs.results || []).map(r => {
      let prefs = {};
      try { prefs = JSON.parse(r.prefs); } catch {}
      return { accountId: r.account_id, erId: r.er_id, erName: r.er_name, name: r.name, username: r.username, sex: r.sex, prefs, at: r.updated_at, appliedAt: r.applied_at };
    });
    accounts = cnt.results[0].n;
  }
  const now = Date.now();
  return json({
    ok: true,
    now,
    ym: ym || null,
    portals: portals.map(p => ({ ym: p.ym, opensAt: p.opens_at, closesAt: p.closes_at, closedAt: p.closed_at, openedBy: p.opened_by, open: isOpen(p, now) })),
    requests,
    accounts,
  });
}

async function openPortal(request, env, auth, ctx) {
  const b = await readJson(request) || {};
  const hosp = String(b.hosp || ''), ym = String(b.ym || '');
  if (!HOSP_RE.test(hosp) || !YM_RE.test(ym)) return json({ error: 'bad_request' }, 400);
  if (!canAdmin(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const now = Date.now();
  const closesAt = Math.floor(Number(b.closesAt));
  if (!(closesAt > now + 10 * 60 * 1000) || closesAt > now + MAX_PORTAL_DAYS * DAY) return json({ error: 'bad_deadline' }, 400);
  const by = auth.name ? `${auth.r}:${auth.name}` : auth.r;
  const existing = await env.DB.prepare('SELECT * FROM er_portals WHERE hosp = ? AND ym = ?').bind(hosp, ym).first();
  const wasOpen = isOpen(existing, now);
  await env.DB.batch([
    // One open portal per hospital: opening another month ends the previous one.
    env.DB.prepare('UPDATE er_portals SET closed_at = ?3 WHERE hosp = ?1 AND ym <> ?2 AND closed_at IS NULL AND closes_at > ?3').bind(hosp, ym, now),
    env.DB.prepare(
      `INSERT INTO er_portals (hosp, ym, opens_at, closes_at, opened_by, closed_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)
       ON CONFLICT (hosp, ym) DO UPDATE SET closes_at = excluded.closes_at, closed_at = NULL,
         opens_at = CASE WHEN er_portals.closed_at IS NULL AND er_portals.closes_at > ?3 THEN er_portals.opens_at ELSE excluded.opens_at END,
         opened_by = excluded.opened_by`
    ).bind(hosp, ym, now, closesAt, by),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 0)').bind(now, by, `ER portal ${hosp} ${ym} open until ${new Date(closesAt).toISOString()}`),
  ]);
  // Residents hear about it when it opens, and again when the admin asks (e.g. a new deadline).
  let notified = 0;
  if (!wasOpen || b.notify) {
    const res = await notifyHospitalResidents(env, hosp, `erportal:${hosp}:${ym}`, 'er_portal', JSON.stringify({ hosp, ym, closes: closesAt, extended: wasOpen }), now).run();
    notified = (res.results || []).length;
    dispatchPush(env, ctx, res);
  }
  return json({ ok: true, notified, portal: { ym, closesAt, open: true } });
}

async function closePortal(request, env, auth) {
  const b = await readJson(request) || {};
  const hosp = String(b.hosp || ''), ym = String(b.ym || '');
  if (!HOSP_RE.test(hosp) || !YM_RE.test(ym)) return json({ error: 'bad_request' }, 400);
  if (!canAdmin(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const now = Date.now();
  await env.DB.prepare('UPDATE er_portals SET closed_at = ? WHERE hosp = ? AND ym = ? AND closed_at IS NULL').bind(now, hosp, ym).run();
  return json({ ok: true });
}

/** The ER page copied these requests into the residents database (only stamps unchanged requests). */
async function markApplied(request, env, auth) {
  const b = await readJson(request) || {};
  const hosp = String(b.hosp || ''), ym = String(b.ym || '');
  if (!HOSP_RE.test(hosp) || !YM_RE.test(ym)) return json({ error: 'bad_request' }, 400);
  if (!canAdmin(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 500).filter(i => i && typeof i.accountId === 'string' && Number(i.at) > 0);
  if (!items.length) return json({ ok: true, n: 0 });
  const now = Date.now();
  const stmts = items.map(i => env.DB.prepare('UPDATE er_pref_requests SET applied_at = ? WHERE hosp = ? AND ym = ? AND account_id = ? AND updated_at = ?')
    .bind(now, hosp, ym, i.accountId, Number(i.at)));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return json({ ok: true, n: items.length, at: now });
}
