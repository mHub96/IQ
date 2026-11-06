/**
 * The Basra clinics guide (دليل البصرة الطبي): private clinics, centres, labs and pharmacies, shown in
 * the Specialists page (hub-guide.js). One D1 row (migration 0023), built by tools/guide/pdf_to_guide.py.
 *
 *   GET  /api/guide?v=<version>  signed in: { ok, v, guide } — or { ok, v, same: true } when the
 *                                page's copy is current, { ok, none: true } before the first upload
 *   POST /api/guide              the owner: the guide's JSON (replaces the stored one)
 *
 * Reads: one row for the version check; the data itself is kept in the isolate's memory by version,
 * so a fresh copy is read from D1 only once per isolate after each upload. The stored JSON is sent
 * as it is (never parsed on reads: the free plan allows 10 ms of CPU).
 */
import { json } from './lib.js';

const ID = 'basra';
const MAX_BYTES = 1900000;   // D1 keeps up to 2 MB in one value
let memo = null;             // { v, body }

export async function routeGuide(path, method, request, env, auth, url) {
  if (path !== '/api/guide') return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (method === 'GET') return readGuide(env, url);
  if (method === 'POST') return auth.r === 'owner' ? writeGuide(request, env, auth) : json({ error: 'forbidden' }, 403);
  return json({ error: 'not_found' }, 404);
}

async function readGuide(env, url) {
  let row;
  try { row = await env.DB.prepare('SELECT v FROM guide WHERE id = ?').bind(ID).first(); }
  catch { row = null; }   // migration 0023 not applied yet
  if (!row) return json({ ok: true, none: true });
  const v = Number(row.v);
  if (Number(url.searchParams.get('v')) === v) return json({ ok: true, v, same: true });
  if (!memo || memo.v !== v) {
    const full = await env.DB.prepare('SELECT v, data FROM guide WHERE id = ?').bind(ID).first();
    if (!full) return json({ ok: true, none: true });
    memo = { v: Number(full.v), body: `{"ok":true,"v":${Number(full.v)},"guide":${full.data}}` };
  }
  return new Response(memo.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const isStr = s => typeof s === 'string';

/** Checks the shape the page relies on and keeps only the known fields. */
function sanitize(g) {
  if (!g || typeof g !== 'object') return null;
  const { cats, secs, items } = g;
  if (!Array.isArray(cats) || !Array.isArray(secs) || !Array.isArray(items) || !items.length) return null;
  if (!cats.every(c => Array.isArray(c) && isStr(c[0]) && isStr(c[1]))) return null;
  if (!secs.every(s => Array.isArray(s) && Number.isInteger(s[0]) && s[0] >= 0 && s[0] < cats.length && isStr(s[1]))) return null;
  if (!items.every(it => Array.isArray(it) && Number.isInteger(it[0]) && it[0] >= 0 && it[0] < secs.length && it.slice(1, 5).every(isStr))) return null;
  const str = (v, n) => (isStr(v) ? v.slice(0, n) : '');
  return {
    title: str(g.title, 120), edition: str(g.edition, 40), author: str(g.author, 120), org: str(g.org, 120),
    contact: str(g.contact, 20), notes: Array.isArray(g.notes) ? g.notes.filter(isStr).slice(0, 10).map(n => n.slice(0, 400)) : [],
    cats: cats.map(c => [str(c[0], 20), str(c[1], 80), str(c[2], 40)]),
    secs: secs.map(s => [s[0], str(s[1], 160), s[2] === 'p' ? 'p' : 'd', s[3] === 'f' || s[3] === 'm' ? s[3] : '', s[4] ? 1 : 0]),
    items: items.map(it => [it[0], str(it[1], 200), str(it[2], 400), str(it[3], 200), str(it[4], 1500)]),
  };
}

async function writeGuide(request, env, auth) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const guide = sanitize(body && body.guide);
  if (!guide) return json({ error: 'bad_guide' }, 400);
  const data = JSON.stringify(guide);
  if (data.length > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const v = Date.now();
  await env.DB.prepare(
    `INSERT INTO guide (id, v, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET v = excluded.v, data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(ID, v, data, v, auth.a || auth.r).run();
  memo = null;
  return json({ ok: true, v, items: guide.items.length });
}
