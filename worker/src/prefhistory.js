/**
 * History of a resident's ER duty preferences, one entry per resident per month (er_pref_history,
 * migration 0020): what they asked for that month (from the preferences portal or the ER page's
 * preferences panel) with their note, and what they had sent on the old Google Form (imported once).
 *
 * Seen by the resident (an account matched to the hospital's ER residents database) in My Schedule,
 * and by whoever may use the hospital's ER page (eraccess.js). Pages of 5, newest month first, read by
 * key from the table's primary key (a page reads 6 rows).
 */

import { json, readJson, overLimit, plainText } from './lib.js';
import { canUseEr } from './eraccess.js';
import { cleanPrefs, findErResident, erResidents, pickResident } from './duties.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const YM_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const ID_RE = /^[\w.:-]{1,80}$/;
const PAGE = 5;
const NOT_RESIDENT = ['rotator', 'aa_user', 'aa_admin'];
const MAX_IMPORT = 2000;

/** Routes under /api/er-pref-history. Null when not matched. */
export async function routePrefHistory(path, method, request, env, auth, url) {
  if (!/^\/api\/er-pref-history(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/er-pref-history/mine': return mine(env, auth, url);
    case 'GET /api/er-pref-history': return ofResident(env, auth, url);
    case 'POST /api/er-pref-history': return saveFromEr(request, env, auth);
    case 'POST /api/er-pref-history/import': return importEntries(request, env, auth);
  }
  return json({ error: 'not_found' }, 404);
}

/** One page of a resident's history: months before `before` (YYYY-MM), newest first. */
async function page(env, hosp, erId, before) {
  const { results } = await env.DB.prepare(
    `SELECT ym, prefs, note, source, updated_at, imported FROM er_pref_history
      WHERE hosp = ?1 AND er_id = ?2 AND ym < ?3 ORDER BY ym DESC LIMIT ${PAGE + 1}`
  ).bind(hosp, erId, YM_RE.test(before || '') ? before : '9999-99').all();
  const rows = results || [];
  const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return {
    entries: rows.slice(0, PAGE).map(r => ({ ym: r.ym, prefs: parse(r.prefs), note: r.note || '', source: r.source, at: r.updated_at, imported: parse(r.imported) })),
    more: rows.length > PAGE,
  };
}

async function mine(env, auth, url) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (NOT_RESIDENT.includes(auth.r)) return json({ error: 'residents_only' }, 403);
  const acc = await env.DB.prepare('SELECT id, name, hosp, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  if (!acc) return json({ error: 'account_required' }, 403);
  const er = await findErResident(env, acc);
  if (!er) return json({ ok: true, er: null, entries: [], more: false });
  return json({ ok: true, er: { id: er.id, name: er.name }, ...(await page(env, acc.hosp, er.id, url.searchParams.get('before'))) });
}

async function ofResident(env, auth, url) {
  const hosp = String(url.searchParams.get('hosp') || ''), erId = String(url.searchParams.get('er') || '');
  if (!HOSP_RE.test(hosp) || !ID_RE.test(erId)) return json({ error: 'bad_request' }, 400);
  if (!(await canUseEr(env, auth, hosp))) return json({ error: 'forbidden' }, 403);
  return json({ ok: true, ...(await page(env, hosp, erId, url.searchParams.get('before'))) });
}

/** The statement that records a month's preferences (portal or ER page); the imported part is kept. */
export function historyStatement(env, { hosp, erId, erName, ym, prefs, source, now = Date.now() }) {
  const note = plainText(prefs && prefs.prefNote, 500) || null;
  return env.DB.prepare(
    `INSERT INTO er_pref_history (hosp, er_id, ym, er_name, prefs, note, source, updated_at, imported)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
     ON CONFLICT (hosp, er_id, ym) DO UPDATE SET er_name = excluded.er_name, prefs = excluded.prefs, note = excluded.note,
       source = excluded.source, updated_at = excluded.updated_at`
  ).bind(hosp, erId, ym, plainText(erName, 120) || null, JSON.stringify(prefs), note, source, now);
}

/** The ER page saved a resident's preferences while showing month `ym`. */
async function saveFromEr(request, env, auth) {
  const b = await readJson(request) || {};
  const hosp = String(b.hosp || ''), ym = String(b.ym || ''), erId = String(b.erId || '');
  if (!HOSP_RE.test(hosp) || !YM_RE.test(ym) || !ID_RE.test(erId)) return json({ error: 'bad_request' }, 400);
  if (!(await canUseEr(env, auth, hosp))) return json({ error: 'forbidden' }, 403);
  if (await overLimit(env, 'prefhist:' + (auth.a || auth.r), 300)) return json({ error: 'rate_limited' }, 429);
  await historyStatement(env, { hosp, erId, erName: b.erName, ym, prefs: cleanPrefs(b.prefs, ym), source: 'er' }).run();
  return json({ ok: true });
}

/**
 * Old Google Form answers: [{ name, phone?, ym, items: [[label, value]…] }]. Each name is matched to
 * the hospital's ER residents database (phone, then name); the answers of a month are stored with that
 * month's entry. Returns the names that matched nobody.
 */
async function importEntries(request, env, auth) {
  const b = await readJson(request) || {};
  const hosp = String(b.hosp || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  if (!(await canUseEr(env, auth, hosp))) return json({ error: 'forbidden' }, 403);
  const entries = (Array.isArray(b.entries) ? b.entries : []).slice(0, MAX_IMPORT);
  const rows = await erResidents(env, hosp);
  if (!rows.length) return json({ error: 'no_er_residents' }, 409);
  const now = Date.now();
  const unmatched = new Set(), matched = new Map(), byMonth = new Map();
  for (const e of entries) {
    const name = plainText(e && e.name, 120), ym = String(e && e.ym || '');
    if (!name || !YM_RE.test(ym)) continue;
    const items = (Array.isArray(e.items) ? e.items : []).slice(0, 20)
      .map(x => [plainText(x && x[0], 80), plainText(x && x[1], 1500)]).filter(x => x[0] && x[1]);
    const r = pickResident(rows, { name, phone: e.phone || '' });
    if (!r) { unmatched.add(name); continue; }
    matched.set(name, r.name);
    // Two spellings of one resident in the same month: one entry with both answers.
    const k = `${r.id}|${ym}`, cur = byMonth.get(k);
    if (cur) { cur.items.push(...items); cur.at = Math.max(cur.at || 0, Number(e.at) || 0) || null; }
    else byMonth.set(k, { r, ym, name, at: Number(e.at) || null, items });
  }
  const stmts = [];
  for (const { r, ym, name, at, items } of byMonth.values()) {
    const imported = JSON.stringify({ name, at, items: items.slice(0, 20) });
    stmts.push(env.DB.prepare(
      `INSERT INTO er_pref_history (hosp, er_id, ym, er_name, prefs, note, source, updated_at, imported)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'import', ?5, ?6)
       ON CONFLICT (hosp, er_id, ym) DO UPDATE SET imported = excluded.imported`
    ).bind(hosp, String(r.id), ym, r.name || name, now, imported));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)')
    .bind(now, auth.name ? `${auth.r}:${auth.name}` : auth.r, `ER preference history import ${hosp}`, stmts.length).run();
  return json({ ok: true, saved: stmts.length, residents: new Set([...byMonth.values()].map(x => String(x.r.id))).size, unmatched: [...unmatched] });
}
