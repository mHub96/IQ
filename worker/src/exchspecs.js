/**
 * A resident exchanges duties only in the specialties whose duties their name can be put in, as the
 * exchange page offers them (hub-core.js exchangeSpecialtiesFor). The owner, the hospitals' admins and
 * shared-password sessions have no such limit.
 */

/** Personal resident accounts are limited; everyone else is not. */
export const limitedExchanger = auth => !!auth && !!auth.a && ['user', 'anaesthesia'].includes(auth.r);

/** Does resident `r` belong in specialty `specId` of a hospital with these specialties? (no fallback) */
function inSpecialty(specs, specId, r) {
  if (!r || r.active === false || r.spec === 'RESERVE') return false;
  const s = specs.find(x => x && x.id === specId);
  const pool = s && Array.isArray(s.acceptPool) ? s.acceptPool : [];
  if (pool.includes('ALL') || pool.includes('*')) return true;
  const dept = r.dept || r.department || r.spec || r.tag;
  if (!dept) return false;
  if (dept === specId) return true;
  if (s && s.parentSpec && dept === s.parentSpec) return true;
  if (specs.some(x => x && x.parentSpec === specId && x.id === dept)) return true;
  return pool.includes(dept);
}

const parse = t => { try { return JSON.parse(t); } catch { return null; } };

/** The specialty ids of hospital `hosp` that this account's resident may exchange duties in. */
export async function exchangeSpecialties(env, accountId, hosp) {
  const row = await env.DB.prepare(
    `SELECT (SELECT data FROM records WHERE coll = 'resident' AND id = a.resident_id) AS res,
            (SELECT data FROM records WHERE coll = 'hospital' AND id = ?2) AS hosp
       FROM accounts a WHERE a.id = ?1`
  ).bind(accountId, hosp).first();
  const res = row && parse(row.res), h = row && parse(row.hosp);
  if (!res || !h || !Array.isArray(h.specialties)) return new Set();
  const inHosp = id => Array.isArray(res.hospitals) && res.hospitals.includes(id);
  const out = new Set();
  // Cloned specialties take their residents from the source hospital.
  const clones = h.specialties.filter(s => s && s.isClone && s.clonedFromHospitalId);
  const sources = new Map();
  for (const id of [...new Set(clones.map(s => s.clonedFromHospitalId))]) {
    const src = await env.DB.prepare("SELECT data FROM records WHERE coll = 'hospital' AND id = ?").bind(id).first();
    const d = src && parse(src.data);
    if (d && Array.isArray(d.specialties)) sources.set(id, d.specialties);
  }
  for (const s of h.specialties) {
    if (!s || !s.id) continue;
    if (s.isClone && s.clonedFromHospitalId) {
      const srcSpecs = sources.get(s.clonedFromHospitalId);
      if (srcSpecs && inHosp(s.clonedFromHospitalId) && inSpecialty(srcSpecs, s.clonedFromSpecId, res)) out.add(s.id);
    } else if (inHosp(hosp) && inSpecialty(h.specialties, s.id, res)) {
      out.add(s.id);
    }
  }
  return out;
}

/**
 * Roster writes outside the resident's specialties: the ops (by index) to refuse. A new or changed
 * entry must be in one of them, and so must the entry it replaces or deletes.
 */
export async function foreignScheduleOps(env, auth, ops) {
  const out = new Set();
  const mine = ops.map((op, i) => ({ op, i })).filter(({ op }) => op && op.c === 'sched' && typeof op.id === 'string' && !op.ordOnly);
  if (!mine.length) return out;
  const { results } = await env.DB.prepare(
    "SELECT id, json_extract(data, '$.specCode') AS s FROM records WHERE coll = 'sched' AND id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(mine.map(({ op }) => op.id))).all();
  const before = new Map((results || []).map(r => [r.id, r.s]));
  const allowed = new Map();
  for (const { op, i } of mine) {
    const hosp = op.id.split(':')[0];
    if (!allowed.has(hosp)) allowed.set(hosp, await exchangeSpecialties(env, auth.a, hosp));
    const set = allowed.get(hosp);
    const old = before.get(op.id);
    const next = op.del ? undefined : op.d && op.d.specCode;
    if ((old != null && !set.has(old)) || (!op.del && !set.has(next))) out.add(i);
  }
  return out;
}
