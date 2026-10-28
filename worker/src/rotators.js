/**
 * Rotators in the hospital database. Every approved rotator account has an entry under the rotators'
 * specialty of its hospital (the admin page's residents database): one found at sign-up is linked to
 * the account; otherwise the entry is added when the account is approved (and, for accounts approved
 * before this existed, by the 10-minute cron). Per hospital, the owner or an admin can switch on the
 * number check: a rotator whose name and number are not in the database cannot sign up.
 */

import { json, readJson } from './lib.js';
import { nameKey, nameTokens, phoneKey } from './names.js';
import { isRotatorSpec } from './exchspecs.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const NO_PHONE = 'رقم غير متوفر';
const TITLE_RE = /^(د\.|د|dr\.|dr)[\s:/]+/i;
const parse = t => { try { return JSON.parse(t); } catch { return null; } };

/** Hospitals where a rotator's name and number must be in the database to sign up (kv 'rotator_phone_check'). */
export async function rotatorCheckHospitals(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'rotator_phone_check'").first();
  const v = parse((row && row.v) || '[]');
  return Array.isArray(v) ? v : [];
}

const manages = (auth, hosp) => auth.r === 'owner' || (auth.r === 'admin' && ((auth.h || []).includes('*') || (auth.h || []).includes(hosp)));

/** Body: { hosp, on }. The owner switches any hospital, an admin their own. */
export async function setRotatorCheck(request, env, auth) {
  const body = await readJson(request) || {};
  const hosp = String(body.hosp || '');
  if (!HOSP_RE.test(hosp) || typeof body.on !== 'boolean') return json({ error: 'bad_request' }, 400);
  if (!manages(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const on = new Set(await rotatorCheckHospitals(env));
  if (body.on) on.add(hosp); else on.delete(hosp);
  const by = auth.a ? `${auth.r}:${auth.name || auth.a}` : auth.r;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('rotator_phone_check', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify([...on])),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), by, `Rotator number check ${body.on ? 'on' : 'off'} (${hosp})`),
  ]);
  return json({ ok: true, on: [...on] });
}

/** The store's specialties and the hospital's own (the store first, as isRotatorSpec expects). */
async function specsOf(env, hosp) {
  const [meta, hospital] = await env.DB.batch([
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
  ]);
  const store = ((parse(meta.results[0] && meta.results[0].data) || {}).value) || [];
  const row = hospital.results[0];
  const own = row ? parse(row.specs || '[]') : null;
  return { store: Array.isArray(store) ? store : [], hospital: !!row, own: Array.isArray(own) ? own : [] };
}

/**
 * The hospital's rotators' specialty (not a branch). `add`: the store's copy to put in the hospital
 * first, when the hospital does not have one yet.
 */
function rotatorSpecOf({ store, own }) {
  const all = [...store, ...own];
  const mine = own.find(s => s && s.id && !s.isClone && !s.parentSpec && isRotatorSpec(all, s.id));
  if (mine) return { spec: mine, add: null };
  const g = store.find(s => s && s.id && !s.parentSpec && isRotatorSpec(store, s.id));
  return g ? { spec: g, add: { ...g, enabled: true, color: g.color || '#0f766e' } } : { spec: null, add: null };
}

/** Rotator entries of the hospital's database, with whether an account already holds them. */
async function rotatorRecords(env, hosp, specs) {
  const all = [...specs.store, ...specs.own];
  const codes = [...new Set(all.filter(s => s && s.id && isRotatorSpec(all, s.id)).map(s => s.id))];
  if (!codes.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT r.id, json_extract(r.data, '$.name') AS name, json_extract(r.data, '$.phone') AS phone,
            (SELECT 1 FROM accounts a WHERE a.resident_id = r.id AND a.status IN ('pending', 'active')) AS taken
       FROM records r WHERE r.coll = 'resident'
        AND COALESCE(json_extract(r.data, '$.dept'), json_extract(r.data, '$.department'), json_extract(r.data, '$.spec'), json_extract(r.data, '$.tag')) IN (SELECT value FROM json_each(?2))
        AND EXISTS (SELECT 1 FROM json_each(r.data, '$.hospitals') h WHERE h.value = ?1)`
  ).bind(hosp, JSON.stringify(codes)).all();
  return (results || []).filter(r => r.name).map(r => ({ id: r.id, name: r.name, phone: r.phone, taken: !!r.taken }));
}

/** The free entry for this rotator: same number (and first name), else exactly the same name. */
function pickRecord(records, name, phone) {
  const pk = phoneKey(phone);
  const first = nameTokens(name)[0] || '';
  const free = records.filter(r => !r.taken);
  return (pk && free.find(r => phoneKey(r.phone) === pk && nameTokens(r.name)[0] === first))
    || free.find(r => nameKey(r.name) === nameKey(name)) || null;
}

/** "د. " + the bare name, as the admin page writes it (the specialty's prefix). */
function withPrefix(name, prefix) {
  const bare = String(name || '').trim().replace(/\s+/g, ' ').replace(TITLE_RE, '').trim();
  const p = String(prefix === undefined ? 'د.' : prefix).trim();
  return p ? `${p} ${bare}` : bare;
}

/**
 * Links rotator account `acc` ({ id, name, phone, hosp }) to its entry in the hospital database, adding
 * the entry under the rotators' specialty when there is none. Only while the account has no entry yet
 * (two runs at once cannot add it twice). Returns { linked, added, id, name } or null.
 */
export async function ensureRotatorRecord(env, acc, by, cache) {
  if (!acc || !acc.id || !HOSP_RE.test(String(acc.hosp || ''))) return null;
  // `cache` (hospital -> specialties): read once per hospital when many rotators are handled together.
  const specs = (cache && cache.get(acc.hosp)) || await specsOf(env, acc.hosp);
  if (cache) cache.set(acc.hosp, specs);
  if (!specs.hospital) return null;
  const now = Date.now();
  const unlinked = 'EXISTS (SELECT 1 FROM accounts WHERE id = ?1 AND resident_id IS NULL)';
  const found = pickRecord(await rotatorRecords(env, acc.hosp, specs), acc.name, acc.phone);
  if (found) {
    const res = await env.DB.prepare(
      `UPDATE accounts SET resident_id = ?2, name = ?3 WHERE id = ?1 AND resident_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM accounts WHERE resident_id = ?2 AND status IN ('pending', 'active'))`
    ).bind(acc.id, found.id, found.name).run();
    return res.meta && res.meta.changes ? { linked: true, added: false, id: found.id, name: found.name } : null;
  }
  const { spec, add } = rotatorSpecOf(specs);
  if (!spec) return null;
  const pk = phoneKey(acc.phone);
  const id = 'res-' + now.toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
  const name = withPrefix(acc.name, spec.prefix);
  const rec = { id, name, phone: pk ? '+964' + pk : '', spec: spec.id, tag: spec.id, dept: spec.id, department: spec.id, active: true, hospitals: [acc.hosp] };
  // The hospital record keeps its own copy of its residents (hospitalNamesFrom in hub-core.js).
  const copy = { id, name, phone: rec.phone || NO_PHONE, spec: spec.id, tag: spec.id, dept: spec.id, department: spec.id, active: true, hospitals: [acc.hosp] };
  const msg = `Rotator added to the database: ${name}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO history (coll, id, hosp, v, data, deleted, ts, by, msg)
       SELECT coll, id, hosp, v, data, 0, ?3, ?4, ?5 FROM records WHERE coll = 'hospital' AND id = ?2 AND ${unlinked}`
    ).bind(acc.id, acc.hosp, now, by, msg),
    env.DB.prepare(
      `INSERT INTO records (coll, id, hosp, ord, v, data, updated_at, updated_by, wid)
       SELECT 'resident', ?2, NULL, (SELECT COALESCE(MAX(ord), -1) + 1 FROM records WHERE coll = 'resident'), 1, json(?3), ?4, ?5, NULL
        WHERE ${unlinked}`
    ).bind(acc.id, id, JSON.stringify(rec), now, by),
    env.DB.prepare(
      `UPDATE records SET data = ${add ? "json_insert(json_insert(data, '$.names[#]', json(?3)), '$.specialties[#]', json(?6))" : "json_insert(data, '$.names[#]', json(?3))"},
              v = v + 1, updated_at = ?4, updated_by = ?5, wid = NULL
        WHERE coll = 'hospital' AND id = ?2 AND ${unlinked}`
    ).bind(...[acc.id, acc.hosp, JSON.stringify(copy), now, by, ...(add ? [JSON.stringify(add)] : [])]),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) SELECT ?2, ?3, ?4, 1 WHERE ' + unlinked).bind(acc.id, now, by, msg),
    env.DB.prepare('UPDATE accounts SET resident_id = ?2, name = ?3 WHERE id = ?1 AND resident_id IS NULL').bind(acc.id, id, name),
  ]);
  // The hospital now has the rotators' specialty: the next rotator of the same run must not add it again.
  if (add) specs.own.push(add);
  return { linked: true, added: true, id, name };
}

/**
 * Active rotator accounts without an entry (approved before entries were added): up to a hundred per
 * run, each hospital's specialties read once. Once all have one, this is a single small query.
 */
export async function linkRotators(env) {
  // Through the index of the unlinked rotators (migration 0018; SQLite would otherwise walk every
  // active account), or as before while that index is missing.
  const query = from => env.DB.prepare(
    `SELECT id, name, phone, hosp FROM ${from} WHERE role = 'rotator' AND status = 'active' AND resident_id IS NULL
        AND hosp IN (SELECT id FROM records WHERE coll = 'hospital') ORDER BY created_at LIMIT 101`
  ).all();
  const { results } = await query('accounts INDEXED BY idx_accounts_unlinked_rotators').catch(() => query('accounts'));
  const out = { linked: 0, added: 0, skipped: 0, left: Math.max(0, (results || []).length - 100) };
  const cache = new Map();
  for (const acc of (results || []).slice(0, 100)) {
    try {
      const r = await ensureRotatorRecord(env, acc, 'system:rotators', cache);
      if (!r) out.skipped++;
      else if (r.added) out.added++;
      else out.linked++;
    } catch (err) {
      out.skipped++;
      console.error('rotator entry', acc.id, err && err.message);
    }
  }
  return out;
}
