/**
 * "ER duties" (GET /api/er-today?h=<hospital>): today's ER schedule of a hospital, for every signed-in
 * user of any hospital (doctors find who is in the ER to save time and lives).
 *
 * Both of the hospital's ER systems are read: the residents' ER (hosp_hub_emergency_sched_<h>_<y>_<m>,
 * or the month kept in the ER state record when it has no record of its own yet) and the rotators' ER
 * (hosp_hub_emergency_rsched_<h>_<y>_<m>). Only the ER shifts (not the consultation clinic, the strike or
 * the death certificates). Built once per change of the ER data (revcache), so a visit costs no reads.
 */

import { json, readJson, overLimit, plainText } from './lib.js';
import { isoDate, nameKey } from './names.js';
import { monthPositions } from './duties.js';
import { revision, cachedValue } from './revcache.js';
import { dutyDayNow } from './profile.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const ER_STATE_ID = 'hosp_hub_emergency_state_v3';
export const SHIFTS = [
  { key: 'morning', name: 'الصباحية', start: 8, hours: 6 },
  { key: 'afternoon', name: 'بعد الصباحية', start: 14, hours: 6 },
  { key: 'preNight', name: 'البرينايت', start: 20, hours: 6 },
  { key: 'lateNight', name: 'الليلية', start: 2, hours: 6 },
];

/** The doctors of one ER month on duty day `day` (YYYY-MM-DD): [{ shift, name, place, sys }]. */
export function dayDoctors(month, day, sys) {
  if (!month || typeof month !== 'object' || !Array.isArray(month.er)) return [];
  const row = month.er.find(d => d && isoDate(d.date) === day);
  if (!row) return [];
  const out = [];
  for (const p of monthPositions(month).er) {
    const name = typeof row[p.key] === 'string' ? row[p.key].trim() : '';
    if (!name) continue;
    const shift = p.key.split('.')[0];
    if (!SHIFTS.some(s => s.key === shift)) continue;
    const d = { shift, name, sys };
    if (p.place) d.place = p.place;
    out.push(d);
  }
  return out;
}

// The ER cards' views (the roster cards' «👁» counter, which lives on roster entries): one kv row per
// hospital and duty day, { nameKey: count }, raised in one statement.
const visitKey = (hosp, day) => `ervisit:${hosp}:${day}`;

async function erVisit(request, env, auth) {
  const b = await readJson(request) || {};
  const hosp = String(b.h || ''), key = nameKey(plainText(b.n, 120) || '');
  if (!HOSP_RE.test(hosp) || !key) return json({ error: 'bad_request' }, 400);
  if (await overLimit(env, 'erv:' + (auth.a || auth.r), 60)) return json({ error: 'rate_limited' }, 429);
  const k = visitKey(hosp, dutyDayNow()), path = `$."${key.replace(/"/g, '')}"`;
  const row = await env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES (?1, json_object(?3, 1))
     ON CONFLICT (k) DO UPDATE SET v = json_set(v, ?2, COALESCE(json_extract(v, ?2), 0) + 1)
     RETURNING json_extract(v, ?2) AS n`
  ).bind(k, path, key.replace(/"/g, '')).first();
  return json({ ok: true, visits: row ? row.n : 1 });
}

export async function routeErToday(path, method, request, env, auth, url) {
  if (path === '/api/er-today/visit' && method === 'POST') return auth ? erVisit(request, env, auth) : json({ error: 'unauthorized' }, 401);
  if (path !== '/api/er-today') return null;
  if (method !== 'GET') return json({ error: 'not_found' }, 404);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const hosp = String(url.searchParams.get('h') || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  const day = dutyDayNow();
  const [y, m] = day.split('-').map(Number);
  const rev = await revision(env, 'er');
  const doctors = await cachedValue(`er-today/${hosp}/${day}`, rev, async () => {
    const main = `hosp_hub_emergency_sched_${hosp}_${y}_${m}`;
    const rot = `hosp_hub_emergency_rsched_${hosp}_${y}_${m}`;
    const [rows, kept] = await env.DB.batch([
      env.DB.prepare("SELECT id, data FROM records WHERE coll = 'er' AND id IN (?1, ?2)").bind(main, rot),
      env.DB.prepare("SELECT json_extract(data, ?1) AS v FROM records WHERE coll = 'er' AND id = ?2").bind(`$.monthlySchedules."${hosp}_${y}_${m}"`, ER_STATE_ID),
    ]);
    const parse = t => { try { return JSON.parse(t || 'null'); } catch { return null; } };
    const byId = new Map((rows.results || []).map(r => [r.id, parse(r.data)]));
    const mainMonth = byId.get(main) || parse((kept.results[0] || {}).v);
    return [...dayDoctors(mainMonth, day, 'res'), ...dayDoctors(byId.get(rot), day, 'rot')];
  });
  let visits = {};
  try { visits = JSON.parse(((await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(visitKey(hosp, day)).first()) || {}).v || '{}') || {}; } catch {}
  return json({ ok: true, day, shifts: SHIFTS, doctors: doctors.map(d => ({ ...d, visits: Number(visits[nameKey(d.name)]) || 0 })) });
}
