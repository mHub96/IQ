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
