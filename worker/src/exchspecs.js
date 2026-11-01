import { roleAt, branchSpecAt } from './access.js';

/**
 * A resident exchanges duties only in the specialties whose duties their name can be put in, as the
 * exchange page offers them (hub-core.js exchangeSpecialtiesFor); a rotator only in the rotators'
 * specialty and its branches, in their own hospital. The owner, the hospitals' admins and
 * shared-password sessions have no such limit.
 */

/**
 * Personal accounts are limited in a hospital where they are a resident, branch representative or
 * rotator (their standing there: access.js); the hospital's admins and the owner are not.
 */
export const limitedExchanger = (auth, hosp) => !!auth && !!auth.a && ['user', 'anaesthesia', 'branch', 'rotator'].includes(roleAt(auth, hosp));

/** The rotators' specialty (by its name: "Rotator" / "مقيم دوري"; its code may change). */
const ROTATOR_NAME = s => !!s && (/rotat/i.test(s.name_en || '') || /مقيم\s*دوري|روتيتر/.test(s.name_ar || ''));

/** Is `code` the rotators' specialty or one of its branches? `specs`: the store's first, then the hospital's. */
export function isRotatorSpec(specs, code) {
  const find = id => specs.find(x => x && x.id === id);
  const s = find(code);
  return ROTATOR_NAME(s) || (!!s && !!s.parentSpec && ROTATOR_NAME(find(s.parentSpec)));
}

/** Does resident `r` belong in specialty `specId` of a hospital with these specialties? (no fallback) */
export function inSpecialty(specs, specId, r) {
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

/** The specialty ids of hospital `hosp` that this account may exchange duties in. */
export async function exchangeSpecialties(env, auth, hosp) {
  if (roleAt(auth, hosp) === 'rotator') return rotatorSpecialties(env, hosp);
  const accountId = auth.a;
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

/** A rotator: the rotators' specialty and its branches. */
async function rotatorSpecialties(env, hosp) {
  const [meta, hospital] = await env.DB.batch([
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
  ]);
  let store = [], own = [];
  try { store = (parse(meta.results[0] && meta.results[0].data) || {}).value || []; } catch {}
  try { own = parse(hospital.results[0] && hospital.results[0].specs) || []; } catch {}
  const specs = [...store, ...own];
  return new Set(own.filter(s => s && s.id && !s.isClone && isRotatorSpec(specs, s.id)).map(s => s.id));
}

/** The specialties a branch representative runs: their specialty and its branches. */
export async function branchSpecialties(env, hosp, spec) {
  if (!spec) return new Set();
  const row = await env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp).first();
  return branchOf((row && parse(row.specs)) || [], spec);
}
/** The same from a hospital's specialties already at hand. */
export const branchOf = (specs, spec) => new Set([spec, ...specs.filter(s => s && s.parentSpec === spec).map(s => s.id)]);

/**
 * Roster writes this account may not make: the ops (by index) to refuse. In each hospital the entry
 * and the one it replaces or deletes must be of a specialty the account's standing there allows. A
 * branch representative's own specialty is theirs to edit, also while the hospital's exchanges need
 * approval (`approval`: those hospitals); everything else a resident does there is a request.
 */
export async function foreignScheduleOps(env, auth, ops, approval = new Set()) {
  const out = new Set();
  const mine = ops.map((op, i) => ({ op, i })).filter(({ op }) => op && op.c === 'sched' && typeof op.id === 'string' && !op.ordOnly && limitedExchanger(auth, op.id.split(':')[0]));
  if (!mine.length) return out;
  const { results } = await env.DB.prepare(
    "SELECT id, json_extract(data, '$.specCode') AS s FROM records WHERE coll = 'sched' AND id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(mine.map(({ op }) => op.id))).all();
  const before = new Map((results || []).map(r => [r.id, r.s]));
  const allowed = new Map(), runs = new Map();
  for (const { op, i } of mine) {
    const hosp = op.id.split(':')[0];
    if (!runs.has(hosp)) runs.set(hosp, await branchSpecialties(env, hosp, branchSpecAt(auth, hosp)));
    const own = runs.get(hosp);
    const old = before.get(op.id);
    const next = op.del ? undefined : op.d && op.d.specCode;
    const isOwn = code => own.has(code);
    if ((old == null || isOwn(old)) && (op.del || isOwn(next))) continue;   // their own specialty: nothing more to read
    if (approval.has(hosp)) { out.add(i); continue; }
    if (!allowed.has(hosp)) allowed.set(hosp, await exchangeSpecialties(env, auth, hosp));
    const free = allowed.get(hosp);
    if ((old != null && !free.has(old) && !isOwn(old)) || (!op.del && !free.has(next) && !isOwn(next))) out.add(i);
  }
  return out;
}
