/**
 * ER duties on the exchange page (signup.html): a resident picks «الطوارئ» (the residents' ER) or
 * «طوارئ الدوريين» (the rotators' ER) of their hospital, a date and one of that day's ER duties, sees who
 * holds it and names the replacement.
 *
 *   GET  /api/er-exchange/day?h=<hospital>&sys=res|rot&date=YYYY-MM-DD
 *        that day's ER duties ([{ key, shift, shiftName, place, name }]) and the names of that ER's list
 *   POST /api/er-exchange { h, sys, date, slot, oldName, newName }
 *        exchange approval off (or a moderator asking): the ER month record changes now;
 *        on: a request in exchange_requests (spec '@er:<sys>:<slot>', sched_id = the month record),
 *        decided like a roster exchange (exchange.js), applied by applyErExchange below.
 *
 * Only months kept in their own record (hosp_hub_emergency_sched_ / rsched_<h>_<y>_<m>) can change here:
 * the server never rewrites the ER state record. Both sides of an exchange must be in that ER's list.
 */

import { json, readJson, overLimit, plainText } from './lib.js';
import { nameKey, isoDate } from './names.js';
import { monthPositions, erResidents, pickResident, ROT_SUFFIX } from './duties.js';
import { SHIFTS } from './ertoday.js';
import { roleAt } from './access.js';
import { canUseEr, canUseRotEr } from './eraccess.js';
import { notifyOne, notifyApprovers, dispatchPush } from './accounts.js';
import { approvalHospitals, rotChiefIds } from './exchange.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLOT_RE = /^[A-Za-z][\w.]{0,40}$/;
const ROLES = ['user', 'anaesthesia', 'branch', 'rotator', 'admin', 'owner'];
const ER_STATE_ID = 'hosp_hub_emergency_state_v3';

export const ER_SPEC = /^@er:(res|rot):([A-Za-z][\w.]{0,40})$/;
export const erSpec = (sys, slot) => `@er:${sys}:${slot}`;
export const monthRecordId = (sys, hosp, y, m) => `hosp_hub_emergency_${sys === 'rot' ? 'rsched' : 'sched'}_${hosp}_${y}_${m}`;
const listId = (sys, hosp) => (sys === 'rot' ? hosp + ROT_SUFFIX : hosp);
const shiftOf = key => SHIFTS.find(s => s.key === String(key).split('.')[0]);

/** The label of an ER exchange's duty: «طوارئ الدوريين · الصباحية · 2». */
export function erDutyLabel(spec) {
  const m = ER_SPEC.exec(String(spec || ''));
  if (!m) return null;
  const s = shiftOf(m[2]);
  const n = m[2].split('.')[1];
  return [m[1] === 'rot' ? 'طوارئ الدوريين' : 'الطوارئ', s ? s.name : m[2], n || ''].filter(Boolean).join(' · ');
}

/** May this session change this ER directly (and decide its requests)? Its ER users, the owner; a chief of rotators for the rotators' ER. */
export async function erModerates(env, auth, hosp, sys) {
  return sys === 'rot' ? canUseRotEr(env, auth, hosp) : canUseEr(env, auth, hosp);
}

async function readMonth(env, sys, hosp, day) {
  const [, y, mm] = DAY_RE.exec(day);
  const id = monthRecordId(sys, hosp, Number(y), Number(mm));
  const row = await env.DB.prepare("SELECT v, data FROM records WHERE coll = 'er' AND id = ?").bind(id).first();
  let month = null;
  try { month = row ? JSON.parse(row.data) : null; } catch {}
  if (!month && sys === 'res') {
    // A month that has no record of its own yet: shown, not changed here.
    const kept = await env.DB.prepare("SELECT json_extract(data, ?1) AS v FROM records WHERE coll = 'er' AND id = ?2")
      .bind(`$.monthlySchedules."${hosp}_${Number(y)}_${Number(mm)}"`, ER_STATE_ID).first();
    try { month = kept && kept.v ? JSON.parse(kept.v) : null; } catch {}
    return { id, month, v: null, editable: false };
  }
  return { id, month, v: row ? row.v : null, editable: !!row };
}

/** The ER duties of one day: [{ key, shift, shiftName, place, name }] (empty positions included). */
function dayPositions(month, day) {
  if (!month || !Array.isArray(month.er)) return [];
  const row = month.er.find(d => d && isoDate(d.date) === day);
  if (!row) return [];
  return monthPositions(month).er
    .map(p => ({ p, s: shiftOf(p.key) }))
    .filter(({ s }) => s)
    .map(({ p, s }) => ({ key: p.key, shift: s.key, shiftName: s.name, place: p.place || '', name: typeof row[p.key] === 'string' ? row[p.key].trim() : '' }));
}

const activeNames = rows => rows.filter(r => r.name && r.active !== 0 && r.active !== false).map(r => String(r.name).trim());

/**
 * Puts `newName` in place of `oldName` in the duty `slot` of day `day` of the ER month record `recId`.
 * Resolves to null (done) or an error code: 'duty_changed' (no longer that duty), 'month_missing'.
 */
export async function applyErExchange(env, { recId, day, slot, oldName, newName, by, msg }) {
  const row = await env.DB.prepare("SELECT v, data FROM records WHERE coll = 'er' AND id = ?").bind(recId).first();
  if (!row) return 'month_missing';
  let month = null;
  try { month = JSON.parse(row.data); } catch {}
  const d = month && Array.isArray(month.er) ? month.er.find(x => x && isoDate(x.date) === day) : null;
  if (!d || nameKey(d[slot] || '') !== nameKey(oldName)) return 'duty_changed';
  d[slot] = newName;
  const now = Date.now();
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE records SET data = ?1, v = v + 1, updated_at = ?2, updated_by = ?3, wid = NULL WHERE coll = 'er' AND id = ?4 AND v = ?5")
      .bind(JSON.stringify(month), now, by, recId, row.v),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(now, by, msg),
  ]);
  return res[0].meta.changes ? null : 'duty_changed';
}

export async function routeErExchange(path, method, request, env, auth, url, ctx) {
  if (!/^\/api\/er-exchange(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (method === 'GET' && path === '/api/er-exchange/day') return day(env, auth, url);
  if (method === 'POST' && path === '/api/er-exchange') return exchange(request, env, auth, ctx);
  return json({ error: 'not_found' }, 404);
}

async function allowed(env, auth, hosp, sys) {
  return ROLES.includes(roleAt(auth, hosp)) || erModerates(env, auth, hosp, sys);
}

async function day(env, auth, url) {
  const hosp = String(url.searchParams.get('h') || ''), sys = url.searchParams.get('sys') === 'rot' ? 'rot' : 'res';
  const date = String(url.searchParams.get('date') || '');
  if (!HOSP_RE.test(hosp) || !DAY_RE.test(date)) return json({ error: 'bad_request' }, 400);
  if (!(await allowed(env, auth, hosp, sys))) return json({ error: 'not_your_hospital' }, 403);
  const [{ month, editable }, rows, on, mod] = await Promise.all([
    readMonth(env, sys, hosp, date),
    erResidents(env, listId(sys, hosp)),
    approvalHospitals(env),
    erModerates(env, auth, hosp, sys),
  ]);
  return json({
    ok: true, date, sys, editable,
    duties: dayPositions(month, date),
    residents: activeNames(rows),
    approval: on.includes(hosp) && !mod,
  });
}

async function exchange(request, env, auth, ctx) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const b = await readJson(request) || {};
  const hosp = String(b.h || ''), sys = b.sys === 'rot' ? 'rot' : 'res', date = String(b.date || ''), slot = String(b.slot || '');
  const oldName = plainText(b.oldName, 120), newName = plainText(b.newName, 120);
  if (!HOSP_RE.test(hosp) || !DAY_RE.test(date) || !SLOT_RE.test(slot) || !oldName || !newName) return json({ error: 'bad_request' }, 400);
  if (nameKey(oldName) === nameKey(newName)) return json({ error: 'same_person' }, 400);
  if (!(await allowed(env, auth, hosp, sys))) return json({ error: 'not_your_hospital' }, 403);
  if (await overLimit(env, 'erx:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);

  const [{ id: recId, month, editable }, rows, on, mod] = await Promise.all([
    readMonth(env, sys, hosp, date),
    erResidents(env, listId(sys, hosp)),
    approvalHospitals(env),
    erModerates(env, auth, hosp, sys),
  ]);
  if (!editable) return json({ error: 'month_missing' }, 409);
  const duty = dayPositions(month, date).find(p => p.key === slot);
  if (!duty || !duty.name || nameKey(duty.name) !== nameKey(oldName)) return json({ error: 'duty_not_found' }, 404);
  // The replacement is one of this ER's doctors (their name as the ER list writes it).
  const names = activeNames(rows);
  const replacement = names.find(n => nameKey(n) === nameKey(newName));
  if (!replacement) return json({ error: 'not_in_er' }, 400);
  if (!mod) {
    // A resident exchanges in the ER whose list has them.
    const acc = await env.DB.prepare('SELECT name, phone FROM accounts WHERE id = ?').bind(auth.a).first();
    if (!acc || !pickResident(rows, acc)) return json({ error: 'not_your_er' }, 403);
  }
  const [y, mo, d] = date.split('-');
  const dmy = `${d}/${mo}/${y}`;
  const spec = erSpec(sys, slot);
  const label = erDutyLabel(spec);
  const by = auth.name ? `${auth.r}:${auth.name}` : auth.r;

  if (!on.includes(hosp) || mod) {
    const err = await applyErExchange(env, { recId, day: date, slot, oldName: duty.name, newName: replacement, by,
      msg: `ER Duty Exchange: ${label} on ${dmy}: ${duty.name} → ${replacement}` });
    if (err) return json({ error: err }, 409);
    return json({ ok: true, status: 'applied', newName: replacement });
  }

  // Approval on: a request (the duty holder, then the hospital's admins / the ER's moderators).
  const dup = await env.DB.prepare(`SELECT id FROM exchange_requests WHERE sched_id = ? AND spec = ? AND date = ? AND status IN ('owner_pending', 'admin_pending')`)
    .bind(recId, spec, dmy).first();
  if (dup) return json({ error: 'already_requested' }, 409);
  // The duty holder's account: an active account of this hospital that matches their ER list entry
  // (by phone, then by name, as the preferences portal matches).
  const holderRow = rows.find(r => nameKey(r.name) === nameKey(duty.name)) || { name: duty.name };
  const cands = await env.DB.prepare(
    `SELECT id, name, phone FROM accounts WHERE status = 'active' AND role IN ('user', 'anaesthesia', 'branch', 'admin', 'rotator')
      AND (hosp = ?1 OR EXISTS (SELECT 1 FROM json_each(accounts.hospitals) WHERE value = ?1)) AND (name_key = ?2 OR phone = ?3)`
  ).bind(hosp, nameKey(duty.name), holderRow.phone || '-').all();
  const hits = (cands.results || []).filter(a => pickResident([holderRow], a));
  const holderId = hits.length === 1 ? hits[0].id : null;
  const ownerId = holderId && holderId !== auth.a ? holderId : null;
  const status = ownerId ? 'owner_pending' : 'admin_pending';
  const now = Date.now();
  const ins = await env.DB.prepare(
    `INSERT INTO exchange_requests (hosp, date, spec, old_name, new_name, sched_id, requester_id, requester_name, owner_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(hosp, dmy, spec, duty.name, replacement, recId, auth.a, auth.name || '', ownerId, status, now, now).first();
  const data = JSON.stringify({ id: ins.id, h: hosp, date: dmy, spec, er: label, oldName: duty.name, newName: replacement, by: auth.name || '' });
  const notes = ownerId
    ? [await notifyOne(env, ownerId, 'xreq:' + ins.id, 'exchange_request', data, now).all()]
    : await notifyErApprovers(env, hosp, sys, 'xadm:' + ins.id, data, now);
  dispatchPush(env, ctx, ...notes);
  return json({ ok: true, id: ins.id, status });
}

/** The hospital's admins (and the owner); for the rotators' ER also its chiefs of rotators. Returns the .all() results. */
export async function notifyErApprovers(env, hosp, sys, gkey, data, now) {
  const out = [await notifyApprovers(env, hosp, gkey, 'exchange_admin', data, now).all()];
  if (sys === 'rot') {
    for (const id of await rotChiefIds(env, hosp)) out.push(await notifyOne(env, id, gkey, 'exchange_admin', data, now).all());
  }
  return out;
}
