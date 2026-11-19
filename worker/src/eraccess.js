/**
 * Who may use the ER page (and its data, fonts and preferences portal).
 *
 * The owner always. A hospital admin for the hospitals in their scope whose ER switch is on
 * (hospital record: erEnabled) and that name them in erAdmins, the owner's pick of the hospital's
 * admins: account ids, plus 'shared' for a session opened with the hospital's shared admin password.
 * A hospital without a list yet (switched on before the list existed) is open to all its admins.
 * Only the owner changes erEnabled and erAdmins.
 */

export const SHARED_ADMIN = 'shared';

/** Is this session on the hospital's list? `list` is the stored JSON text (null = no list yet). */
export function erListed(list, auth) {
  if (list === null || list === undefined) return true;
  let ids;
  try { ids = typeof list === 'string' ? JSON.parse(list) : list; } catch { return false; }
  if (!Array.isArray(ids)) return true;
  return ids.includes(auth.a ? auth.a : SHARED_ADMIN);
}

/** Hospitals whose ER this session may use: ['*'] for the owner. */
export async function erHospitals(env, auth) {
  if (!auth) return [];
  if (auth.r === 'owner') return ['*'];
  if (auth.r !== 'admin') return [];
  const { results } = await env.DB.prepare(
    `SELECT id, json_extract(data, '$.erAdmins') AS admins FROM records
      WHERE coll = 'hospital' AND json_extract(data, '$.erEnabled') = 1`
  ).all();
  const scope = auth.h || [];
  return (results || []).filter(h => (scope.includes('*') || scope.includes(h.id)) && erListed(h.admins, auth)).map(h => h.id);
}

/** May this session use the ER page, for `hosp` or (without it) for any hospital? */
export async function canUseEr(env, auth, hosp) {
  const hs = await erHospitals(env, auth);
  return hs.includes('*') || (hosp ? hs.includes(hosp) : hs.length > 0);
}

const erFields = d => JSON.stringify([!!(d && d.erEnabled), d && Array.isArray(d.erAdmins) ? d.erAdmins : null]);

/** Hospital writes (by a non-owner) that would change the ER switch or its admins: those ops are refused. */
export async function erFieldWrites(env, ops) {
  if (!ops.length) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT id, json_extract(data, '$.erEnabled') AS en, json_extract(data, '$.erAdmins') AS admins
       FROM records WHERE coll = 'hospital' AND id IN (SELECT value FROM json_each(?))`
  ).bind(JSON.stringify(ops.map(op => op.id))).all();
  const current = new Map((results || []).map(r => {
    let admins = null;
    try { admins = r.admins === null ? null : JSON.parse(r.admins); } catch {}
    return [r.id, erFields({ erEnabled: !!r.en, erAdmins: admins })];
  }));
  return new Set(ops.filter(op => current.get(op.id) !== erFields(op.d)));
}

// ---------------------------------------------------------------------------
// The rotators' ER of a hospital (emergency.html?sys=rot): its own records, used by the hospital's ER
// admins and the owner, and by its chief of rotators (a branch representative of the Rotator
// specialty), who reaches those records and nothing else of the ER.
// ---------------------------------------------------------------------------
import { branchSpecAt, hospitalsWithRole } from './access.js';
import { isRotatorSpec } from './exchspecs.js';

const ROT_RECORD = /^hosp_hub_emergency_(?:rstate_([\w-]{1,48})|(?:rsched|ralloc|rslots_(?:er|con|dc))_([\w-]{1,48})_\d{4}_\d{1,2})$/;
/** The hospital of a rotators' ER record id, or null when the id is not one. */
export function rotErHospital(id) {
  const m = ROT_RECORD.exec(String(id || ''));
  return m ? (m[1] || m[2]) : null;
}

/** The hospitals where this account is the chief of rotators. */
export async function rotChiefHospitals(env, auth) {
  if (!auth || !auth.a) return [];
  const hosps = hospitalsWithRole(auth, 'branch').filter(h => branchSpecAt(auth, h));
  if (!hosps.length) return [];
  const [meta, ...rows] = await env.DB.batch([
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    ...hosps.map(h => env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(h)),
  ]);
  let store = [];
  try { store = (JSON.parse((meta.results[0] && meta.results[0].data) || '{}').value) || []; } catch {}
  return hosps.filter((h, i) => {
    let own = [];
    try { own = JSON.parse((rows[i].results[0] && rows[i].results[0].specs) || '[]') || []; } catch {}
    return isRotatorSpec([...store, ...own], branchSpecAt(auth, h));
  });
}

/** May this session use the rotators' ER of `hosp`? */
export async function canUseRotEr(env, auth, hosp) {
  if (await canUseEr(env, auth, hosp)) return true;
  return (await rotChiefHospitals(env, auth)).includes(hosp);
}
