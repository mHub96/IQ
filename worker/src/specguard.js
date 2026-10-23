/**
 * The general store of specialties belongs to the owner. A hospital's copy of a store specialty
 * follows the store: its admins set only its colour, visibility, order and the specialties it draws
 * residents from. Their own specialties (not in the store) and clones they edit freely.
 */

import { json, readJson } from './lib.js';

/** The fields a hospital's copy of a store specialty takes from the store. */
const STORE_FIELDS = ['name_ar', 'name_en', 'icon', 'prefix', 'parentSpec', 'branch'];
const BRANCHES = ['surgical', 'medical', 'none'];
const norm = v => (v === undefined || v === null ? '' : String(v));

/** The value a store field has in a hospital's copy (as the site writes it from the store). */
function storeValue(g, f) {
  switch (f) {
    case 'name_ar': return norm(g.name_ar || g.id);
    case 'name_en': return norm(g.name_en);
    case 'icon': return norm(g.icon || '🏥');
    case 'parentSpec': return norm(g.parentSpec);
    // Left automatic in the store: the hospital may choose.
    case 'branch': return BRANCHES.includes(g.branch) ? g.branch : null;
    case 'prefix': return g.prefix === undefined ? null : norm(g.prefix);
    default: return '';
  }
}

const parse = t => { try { return JSON.parse(t); } catch { return null; } };

/**
 * Hospital writes by an admin that change a store specialty's own fields to anything but the store's
 * value: the ops to refuse.
 */
export async function storeSpecWrites(env, ops) {
  const out = new Set();
  if (!ops.length) return out;
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare("SELECT id, data FROM records WHERE coll = 'hospital' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ops.map(op => op.id))),
  ]);
  const meta = rows[0].results[0] && parse(rows[0].results[0].data);
  const store = new Map((Array.isArray(meta && meta.value) ? meta.value : []).filter(g => g && g.id).map(g => [g.id, g]));
  if (!store.size) return out;
  const before = new Map(rows[1].results.map(r => [r.id, parse(r.data)]));
  for (const op of ops) {
    const specs = op.d && Array.isArray(op.d.specialties) ? op.d.specialties : [];
    const old = new Map(((before.get(op.id) || {}).specialties || []).filter(s => s && s.id).map(s => [s.id, s]));
    const bad = specs.some(s => {
      if (!s || s.isClone || !store.has(s.id)) return false;
      const g = store.get(s.id), o = old.get(s.id);
      return STORE_FIELDS.some(f => {
        const v = norm(s[f]);
        if (o && v === norm(o[f])) return false;
        const want = storeValue(g, f);
        return want === null ? false : v !== want;
      });
    });
    if (bad) out.add(op);
  }
  return out;
}

/**
 * The owner changed a store specialty's code: server-side records that name it by code follow
 * (open exchange requests). Body: { from, to }.
 */
export async function renameSpecialtyCode(request, env, auth) {
  if (!auth || auth.r !== 'owner') return json({ error: 'forbidden' }, 403);
  const body = await readJson(request) || {};
  const from = String(body.from || ''), to = String(body.to || '');
  const RE = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
  if (!RE.test(from) || !RE.test(to) || from === to) return json({ error: 'bad_request' }, 400);
  const res = await env.DB.prepare('UPDATE exchange_requests SET spec = ?2 WHERE spec = ?1').bind(from, to).run();
  return json({ ok: true, requests: res.meta.changes || 0 });
}
