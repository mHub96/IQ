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

import { DAY, json, readJson, overLimit, plainText, signToken, verifyToken } from './lib.js';
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
const NOT_RESIDENT = ['rotator', 'aa_user', 'aa_admin'];

// ER month record layout (see emergency.js): which fields of each day row hold a doctor's name.
// Death certificates are not read from the ER scheduler: they are exchanged on the hospital's
// roster, so the roster (its "الوفيات" column) is the one source for them.
const ER_SLOTS = {
  er: ['morning', 'afternoon', 'preNight', 'lateNight'],
  con: ['doctor'],
  rs: ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight', 'ward_private', 'ward_floor4', 'ward_floor5'],
};

/** Routes under /api/accounts/my-duties, /api/accounts/duty-mark and /api/er-portal. Null when not matched. */
export async function routeDuties(path, method, request, env, auth, url, ctx) {
  // The phone's calendar opens this link itself (no sign-in header): a ticket from my-duties stands in.
  if (path === '/api/cal' && method === 'GET') return dutyCalendar(env, url);
  if (!/^\/api\/(accounts\/(my-duties|duty-mark)|er-portal)(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  // My Schedule and the preferences portal are for the hospital's residents (not rotators or division officers).
  if (NOT_RESIDENT.includes(auth.r) && /^\/api\/(accounts\/|er-portal\/mine$)/.test(path)) return json({ error: 'residents_only' }, 403);
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
  if (!YM_RE.test(ym)) return json({ error: 'bad_month' }, 400);
  const acc = await env.DB.prepare('SELECT id, name, name_key, hosp, phone, resident_id FROM accounts WHERE id = ?').bind(auth.a).first();
  if (!acc) return json({ error: 'account_required' }, 403);
  const out = await collectDuties(env, acc, ym);
  // Ticket for this month's calendar file (/api/cal), which the phone's calendar opens without the session.
  out.cal = await signToken(env, { cal: acc.id, ym, e: Date.now() + 7 * DAY });
  return json(out);
}

/** One account's duties (hospital roster + ER scheduler) and marks for a month (YYYY-MM). */
async function collectDuties(env, acc, ym) {
  const m = ym.match(YM_RE);
  const year = Number(m[1]), month = Number(m[2]);

  const er = await findErResident(env, acc);
  const keys = new Set([acc.name_key || nameKey(acc.name)]);
  if (er && er.name) keys.add(nameKey(er.name));

  // Every hospital's roster and ER schedule of the month: a resident who moved keeps the duties of the
  // hospital they were in, each labelled with its hospital.
  const [rosterRes, erRes, marksRes, hospRes, recRes, erListRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, hosp, json_extract(data, '$.date') AS date, json_extract(data, '$.name') AS name,
              json_extract(data, '$.specCode') AS spec, json_extract(data, '$.dutyTime') AS time,
              json_extract(data, '$.dutySlot') AS slot
         FROM records
        WHERE coll = 'sched' AND (json_extract(data, '$.date') LIKE ?1 OR json_extract(data, '$.date') LIKE ?2)`
    ).bind(`%/${String(month).padStart(2, '0')}/${year}`, `%/${month}/${year}`),
    env.DB.prepare(
      `SELECT r.id, r.data FROM records r
        WHERE r.coll = 'er' AND r.id IN (SELECT 'hosp_hub_emergency_sched_' || h.id || '_' || ?1 FROM records h WHERE h.coll = 'hospital')
       UNION ALL
       SELECT 'state', json_extract(data, ?2) FROM records WHERE coll = 'er' AND id = ?3`
    ).bind(`${year}_${month}`, `$.monthlySchedules."${acc.hosp}_${year}_${month}"`, ER_STATE_ID),
    env.DB.prepare('SELECT dkey, kind, flag, flag_text, note, updated_at FROM duty_marks WHERE account_id = ?1 AND dkey LIKE ?2')
      .bind(acc.id, `${ym}-%`),
    env.DB.prepare("SELECT id FROM records WHERE coll = 'hospital'"),
    env.DB.prepare("SELECT json_extract(data, '$.hospitals') AS hs FROM records WHERE coll = 'resident' AND id = ?").bind(acc.resident_id || ''),
    // Who is in each hospital's ER list (the residents that ER assigns duties to).
    env.DB.prepare(
      `SELECT j.key AS h, json_extract(r.value, '$.name') AS n
         FROM records, json_each(records.data, '$.hospitalResidents') j, json_each(j.value) r
        WHERE records.coll = 'er' AND records.id = ?`
    ).bind(ER_STATE_ID),
  ]);
  // The resident's own hospitals: the account's, and those of their record in the hospital database.
  const home = new Set([acc.hosp]);
  try { for (const h of JSON.parse((recRes.results[0] || {}).hs || '[]')) home.add(String(h)); } catch {}
  const keyOf = new Map();
  const matches = n => { if (!n) return false; let k = keyOf.get(n); if (k === undefined) { k = nameKey(n); keyOf.set(n, k); } return keys.has(k); };
  // In another hospital, the same name belongs to that hospital's own resident (someone else) unless
  // nobody there carries it (then it is this resident, from before they moved).
  let othersByHosp = null;
  const someoneElse = async hosp => {
    if (home.has(hosp)) return false;
    if (!othersByHosp) {
      othersByHosp = new Map();
      const { results } = await env.DB.prepare("SELECT id, json_extract(data, '$.name') AS n, json_extract(data, '$.hospitals') AS hs FROM records WHERE coll = 'resident' AND id <> ?")
        .bind(acc.resident_id || '').all();
      for (const r of results) {
        if (!keys.has(nameKey(r.n))) continue;
        let hs = [];
        try { hs = JSON.parse(r.hs || '[]'); } catch {}
        for (const h of hs) othersByHosp.set(String(h), true);
      }
    }
    return othersByHosp.has(hosp);
  };

  const duties = [];
  for (const r of rosterRes.results || []) {
    if (!matches(r.name)) continue;
    const date = isoDate(r.date);
    if (!date || await someoneElse(r.hosp)) continue;
    const slot = Number(r.slot) || 0;
    duties.push({ key: `${date}|h|${r.spec || ''}:${slot}`, date, src: 'hospital', hosp: r.hosp, spec: r.spec || '', time: r.time || '', slot });
  }
  const hospitals = new Set((hospRes.results || []).map(h => h.id));
  const erMonths = new Map();
  for (const row of erRes.results || []) {
    let month = null;
    try { month = JSON.parse(row.data || 'null'); } catch {}
    if (!month || typeof month !== 'object') continue;
    const hosp = row.id === 'state' ? acc.hosp : row.id.replace(/^hosp_hub_emergency_sched_/, '').replace(/_\d{4}_\d{1,2}$/, '');
    if (!hospitals.has(hosp) || (row.id === 'state' && erMonths.has(hosp))) continue;
    erMonths.set(hosp, month);
  }
  // An ER schedule counts only in the hospitals whose ER list has this resident.
  const inErList = new Set((erListRes.results || []).filter(r => matches(r.n)).map(r => r.h));
  for (const [hosp, erMonth] of erMonths) {
    if (!inErList.has(hosp) || await someoneElse(hosp)) continue;
    for (const [type, fields] of Object.entries(ER_SLOTS)) {
      for (const day of Array.isArray(erMonth[type]) ? erMonth[type] : []) {
        const date = isoDate(day && day.date);
        if (!date || !date.startsWith(ym)) continue;
        for (const f of fields) {
          if (day[f] && matches(day[f])) duties.push({ key: `${date}|${type}|${f}`, date, src: 'er', hosp, type, slot: f });
        }
      }
    }
  }
  duties.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const marks = {};
  for (const k of marksRes.results || []) marks[k.dkey] = { kind: k.kind, flag: k.flag, flagText: k.flag_text, note: k.note, at: k.updated_at };
  return { ok: true, ym, hosp: acc.hosp, hospitals: [...new Set(duties.map(d => d.hosp))], name: acc.name, erName: er ? er.name : null, duties, marks };
}

// ---------------------------------------------------------------------------
// Calendar file (.ics): a month of duties with a reminder 24 hours before each, or (mode=remove)
// the cancellation of the same events. UIDs are stable and SEQUENCE grows with time, so the later
// file always wins over the earlier one in the calendar app.
// ---------------------------------------------------------------------------

const IRAQ_UTC_OFFSET_H = 3; // Iraq has no daylight saving
// ER shift [start hour, length in hours]. Hours before 08:00 fall on the next calendar day (the duty day starts at 08:00).
const ER_TIMES = {
  morning: [8, 6], afternoon: [14, 6], preNight: [20, 6], lateNight: [2, 6],
  er_morning: [8, 6], er_afternoon: [14, 6], er_preNight: [20, 6], er_lateNight: [2, 6],
};
const ER_TITLES = {
  er: { morning: 'طوارئ · الصباحية', afternoon: 'طوارئ · بعد الصباحية', preNight: 'طوارئ · البرينايت', lateNight: 'طوارئ · الليلية' },
  con: { doctor: 'الاستشارية الخافرة' },
  dc: { doctor: 'شهادات الوفاة' },
  rs: {
    er_morning: 'إضراب طوارئ · صباحية', er_afternoon: 'إضراب طوارئ · بعد الصباحية', er_preNight: 'إضراب طوارئ · برينايت',
    er_lateNight: 'إضراب طوارئ · ليلية', ward_private: 'إضراب ردهات · الجناح الخاص', ward_floor4: 'إضراب ردهات · طابق 4', ward_floor5: 'إضراب ردهات · طابق 5',
  },
};

/** "08:00PM - 08:00AM" -> [start hour, start minute, length in hours]; a whole duty day (08:00, 24 h) otherwise. */
export function hospitalTimes(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return [8, 0, 24];
  const h24 = (h, ap) => (ap ? (Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0) : Number(h) % 24);
  const sh = h24(m[1], m[3]), sm = Number(m[2]);
  const eh = h24(m[4], m[6]), em = Number(m[5]);
  let len = (eh * 60 + em - (sh * 60 + sm)) / 60;
  if (len <= 0) len += 24;
  return [sh, sm, len];
}

/** UTC time (ms) of h:min Iraq time on duty day `iso` (YYYY-MM-DD); hours before 08:00 are the next morning. */
export function dutyStartUtc(iso, h, min) {
  const [y, mo, d] = iso.split('-').map(Number);
  return Date.UTC(y, mo - 1, d + (h < 8 ? 1 : 0), h - IRAQ_UTC_OFFSET_H, min);
}

const icsTime = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets are folded (RFC 5545) without splitting a UTF-8 character. */
function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildDutyIcs(data, { remove, names, hospName, accountId, now = Date.now() }) {
  const seq = Math.floor((now - Date.UTC(2026, 0, 1)) / 1000);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hospital Hub//My Schedule//AR', 'CALSCALE:GREGORIAN',
    `METHOD:${remove ? 'CANCEL' : 'PUBLISH'}`, 'X-WR-CALNAME:خفاراتي · Hospital Hub', 'X-WR-TIMEZONE:Asia/Baghdad'];
  for (const d of data.duties) {
    let title, h, min = 0, len;
    if (d.src === 'hospital') {
      [h, min, len] = hospitalTimes(d.time);
      title = (names && names[d.spec]) || d.spec || 'خفارة المستشفى';
    } else {
      [h, len] = ER_TIMES[d.slot] || [8, 24];
      title = (ER_TITLES[d.type] || {})[d.slot] || 'خفارة الطوارئ';
    }
    const start = dutyStartUtc(d.date, h, min);
    lines.push('BEGIN:VEVENT', `UID:${accountId}-${d.key.replace(/[^\w-]+/g, '_')}@hosp-hub`, `SEQUENCE:${seq}`, `DTSTAMP:${icsTime(now)}`,
      `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(start + len * 3600 * 1000)}`,
      `SUMMARY:${icsText(`🩺 خفارة: ${title}`)}`,
      `LOCATION:${icsText(hospName || '')}`,
      `DESCRIPTION:${icsText('من «جدولي» في بوابة المستشفيات (Hospital Hub)')}`,
      `STATUS:${remove ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE');
    if (!remove) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT24H', `DESCRIPTION:${icsText(`غداً خفارتك: ${title}`)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

async function dutyCalendar(env, url) {
  const text = (msg, status) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const t = await verifyToken(env, url.searchParams.get('t') || '');
  if (!t || !t.cal || !YM_RE.test(t.ym || '') || !(t.e > Date.now())) return text('انتهت صلاحية رابط التقويم. افتح «جدولي» من جديد ثم اضغط الزر.', 403);
  const acc = await env.DB.prepare("SELECT id, name, name_key, hosp, phone, resident_id FROM accounts WHERE id = ? AND status = 'active'").bind(t.cal).first();
  if (!acc) return text('الحساب غير متاح', 403);
  const data = await collectDuties(env, acc, t.ym);
  const names = {};
  try {
    for (const [k, v] of Object.entries(JSON.parse(url.searchParams.get('n') || '{}')).slice(0, 80)) names[String(k).slice(0, 40)] = plainText(v, 80);
  } catch {}
  const remove = url.searchParams.get('mode') === 'remove';
  const ics = buildDutyIcs(data, { remove, names, hospName: plainText(url.searchParams.get('h'), 120), accountId: acc.id });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `${url.searchParams.get('dl') ? 'attachment' : 'inline'}; filename="duties-${t.ym}${remove ? '-remove' : ''}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
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
