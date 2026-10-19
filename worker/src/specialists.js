/**
 * The per-hospital switch that lets residents add and edit the specialist cards of their own specialty
 * (or of the specialty they rotate in), kv 'spec_edit': JSON array of hospital ids.
 *
 *   GET  /api/specialists/settings   { on: [hospital ids], me: { hosp, codes } | null }  (signed in)
 *   POST /api/specialists/settings   { hosp, on }  the owner any hospital, an admin their own
 *
 * The directory is one record (meta/specialists), so a resident's write is checked card by card in
 * residentSpecialistsEditAllowed(). Deleting a card stays with the admins and the owner.
 */
import { json, neutralize } from './lib.js';

const HOSP_RE = /^[\w-]{1,48}$/;
// Residents with a roster record (personal accounts); rotators and shared-password sessions have none.
const EDIT_ROLES = ['user', 'anaesthesia'];
// The same short forms hub-core.js maps to the canonical specialty codes.
const ALIASES = {
  F: 'FM', E: 'EM', IM: 'M', DERM: 'Der', DC: 'D', PAED: 'Pe', PED: 'Pe', CARDIO: 'H', CARD: 'H', PLAST: 'PS',
  URO: 'US', ORTHO: 'OR', OPHTH: 'O', EYE: 'O', RADIO: 'R', ONCO: 'ON', PSYCH: 'P', RESP: 'RM', PULM: 'RM',
  NEPHRO: 'N', ADMIN: 'AO', EMERGENCY: 'EM', FAMILY: 'FM', FMED: 'FM',
};
const code = v => {
  const s = String(v || '').trim();
  return s ? String(ALIASES[s] || ALIASES[s.toUpperCase()] || s).toUpperCase() : '';
};

const moderates = (a, hosp) => a.r === 'owner' || (a.r === 'admin' && (a.h || []).some(h => h === '*' || h === hosp));

export async function specEditHospitals(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'spec_edit'").first();
  try { const v = JSON.parse((row && row.v) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** A resident's hospital and the specialty codes they may edit (original specialty and rotation). */
async function residentScope(env, auth) {
  if (!auth || !auth.a || !EDIT_ROLES.includes(auth.r) || !auth.hosp) return null;
  const row = await env.DB.prepare(
    `SELECT json_extract(r.data, '$.spec') AS spec, COALESCE(json_extract(r.data, '$.dept'), json_extract(r.data, '$.department')) AS dept
       FROM accounts a JOIN records r ON r.coll = 'resident' AND r.id = a.resident_id
      WHERE a.id = ?`
  ).bind(auth.a).first();
  const codes = row ? [...new Set([code(row.spec), code(row.dept)].filter(Boolean))] : [];
  return codes.length ? { hosp: auth.hosp, codes } : null;
}

export const isResidentEditor = auth => !!auth && !!auth.a && EDIT_ROLES.includes(auth.r);

export async function routeSpecialists(path, method, request, env, auth) {
  if (path !== '/api/specialists/settings') return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (method === 'GET') return json({ ok: true, on: await specEditHospitals(env), me: await residentScope(env, auth) });
  if (method !== 'POST') return json({ error: 'not_found' }, 404);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const hosp = String((body && body.hosp) || '');
  if (!HOSP_RE.test(hosp) || typeof body.on !== 'boolean') return json({ error: 'bad_request' }, 400);
  if (!moderates(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const on = new Set(await specEditHospitals(env));
  if (body.on) on.add(hosp); else on.delete(hosp);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('spec_edit', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify([...on])),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), auth.a ? `${auth.r}:${auth.name || auth.a}` : auth.r, `Residents edit specialists ${body.on ? 'on' : 'off'} (${hosp})`),
  ]);
  return json({ ok: true, on: [...on] });
}

/**
 * A resident's write of the directory: their hospital's switch is on, and every card the write adds or
 * changes is in their hospital and of their specialty or rotation, before and after. No card is removed.
 */
export async function residentSpecialistsEditAllowed(env, auth, op) {
  if (op.del) return false;
  const next = op.d && Array.isArray(op.d.value) ? op.d.value : null;
  if (!next) return false;
  const [scope, on, row] = await Promise.all([
    residentScope(env, auth),
    specEditHospitals(env),
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'specialists'").first(),
  ]);
  if (!scope || !on.includes(scope.hosp)) return false;
  let old = [];
  try { old = (row && JSON.parse(row.data).value) || []; } catch { old = []; }
  const text = s => neutralize(JSON.stringify(s));
  const mine = s => !!s && Array.isArray(s.hospitals) && s.hospitals.includes(scope.hosp) && scope.codes.includes(code(s.spec));
  const byId = list => new Map((Array.isArray(list) ? list : []).filter(s => s && s.id).map(s => [String(s.id), s]));
  const before = byId(old), after = byId(next);
  const noId = list => (Array.isArray(list) ? list : []).filter(s => !s || !s.id).map(text).sort().join('\n');
  if (noId(old) !== noId(next)) return false;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id);
    if (a && b && text(a) === text(b)) continue;
    if (a && !b) return false;
    if ((a && !mine(a)) || !mine(b)) return false;
  }
  return true;
}
