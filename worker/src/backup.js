/**
 * Automatic backups. Every 5 hours a GitHub Action in the private backups repository reads all of
 * the site's data through /api/backup/rows, commits it there (the history of every backup), and puts
 * the newest copy back here (KV namespace BACKUPS), so the restore screens can offer "the latest
 * automatic backup" without a GitHub token in the Worker:
 *   latest:full         the whole system, in the format of the owner's full backup file
 *   latest:hosp:<id>    one hospital, in the format of the hospital admin's backup file
 *
 * The Action authenticates with the X-Backup-Key header (secret BACKUP_KEY). Reading a backup needs
 * a sign-in: the full one is the owner's, a hospital's one the owner's and that hospital's admins'.
 * As everywhere in this Worker, nothing is parsed here: SQLite builds the rows and KV streams files.
 *
 * The owner's full backup file also carries every table of the database as it is (/api/backup/table):
 * accounts and their settings, comments, likes, notifications, XP and duty data, opioid records, the
 * switches... Left out: the edit history (hundreds of MB, the undo log), the ER conflict copies, and
 * the rate-limit and failed-sign-in counters.
 */

import { json, timingSafeEqual } from './lib.js';

const PAGE_ROWS = 1000;
const NAME_RE = /^(full|hosp:[\w-]{1,48})$/;

const keyOk = (request, env) => {
  const k = request.headers.get('X-Backup-Key') || '';
  return !!env.BACKUP_KEY && k.length > 0 && timingSafeEqual(k, env.BACKUP_KEY);
};
const mayRead = (auth, name) => !!auth && (auth.r === 'owner'
  || (name.startsWith('hosp:') && auth.r === 'admin' && ((auth.h || []).includes('*') || (auth.h || []).includes(name.slice(5)))));

export async function routeBackup(path, method, request, env, auth, url) {
  if (!/^\/api\/backup(\/|$)/.test(path)) return null;
  switch (`${method} ${path}`) {
    case 'GET /api/backup/rows': return keyOk(request, env) ? rows(env, url) : json({ error: 'unauthorized' }, 401);
    case 'PUT /api/backup/latest': return keyOk(request, env) ? store(request, env, url) : json({ error: 'unauthorized' }, 401);
    case 'GET /api/backup/latest': return latest(env, auth, url);
    case 'GET /api/backup/info': return info(env, auth);
    case 'GET /api/backup/tables': return auth && auth.r === 'owner' ? tables(env) : json({ error: auth ? 'forbidden' : 'unauthorized' }, auth ? 403 : 401);
    case 'GET /api/backup/table': return auth && auth.r === 'owner' ? table(env, url) : json({ error: auth ? 'forbidden' : 'unauthorized' }, auth ? 403 : 401);
  }
  return json({ error: 'not_found' }, 404);
}

/** All the site's data, page by page: [coll, id, hosp, ord, v, data] (conflict copies left out). */
async function rows(env, url) {
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const row = await env.DB.prepare(
    `SELECT json_group_array(json_array(coll, id, hosp, ord, v, json(data))) AS rows, MAX(rid) AS last, COUNT(*) AS n
       FROM (SELECT rowid AS rid, * FROM records WHERE rowid > ?1 AND coll <> 'er_conflict' ORDER BY rowid LIMIT ${PAGE_ROWS})`
  ).bind(after).first();
  const n = row ? row.n : 0;
  const body = `{"rows":${n ? row.rows : '[]'},"last":${n ? row.last : after},"more":${n === PAGE_ROWS},"time":${Date.now()}}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** The Action stores the newest backup file (?f=full | hosp:<id>, ?made=<ms>, ?ref=<commit>). */
async function store(request, env, url) {
  const name = String(url.searchParams.get('f') || '');
  if (!NAME_RE.test(name) || !request.body) return json({ error: 'bad_request' }, 400);
  const meta = {
    at: Number(url.searchParams.get('made')) || Date.now(),
    size: Number(request.headers.get('Content-Length')) || null,
    ref: String(url.searchParams.get('ref') || '').slice(0, 64) || null,
  };
  await env.BACKUPS.put('latest:' + name, request.body, { metadata: meta });
  return json({ ok: true, name, meta });
}

/** The newest automatic backup file (?f=full | hosp:<id>), streamed as it was stored. */
async function latest(env, auth, url) {
  const name = String(url.searchParams.get('f') || '');
  if (!NAME_RE.test(name)) return json({ error: 'bad_request' }, 400);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!mayRead(auth, name)) return json({ error: 'forbidden' }, 403);
  const got = await env.BACKUPS.getWithMetadata('latest:' + name, { type: 'stream' });
  if (!got || !got.value) return json({ error: 'no_backup' }, 404);
  return new Response(got.value, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Backup-Made': String((got.metadata && got.metadata.at) || ''),
    },
  });
}

/** When the newest backups this session may read were made: { full?, hospitals: { id: meta } }. */
async function info(env, auth) {
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (auth.r !== 'owner' && auth.r !== 'admin') return json({ error: 'forbidden' }, 403);
  const { keys } = await env.BACKUPS.list({ prefix: 'latest:' });
  const out = { ok: true, full: null, hospitals: {} };
  for (const k of keys) {
    const name = k.name.slice(7);
    if (!mayRead(auth, name)) continue;
    if (name === 'full') out.full = k.metadata || {};
    else out.hospitals[name.slice(5)] = k.metadata || {};
  }
  return json(out);
}

const SKIP_TABLES = new Set(['history', 'rate_limit', 'login_fail']);
const TABLE_ROWS = 500;

/** The database's own tables (not SQLite's or Cloudflare's), without the ones the backup leaves out. */
async function tableNames(env) {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all();
  return (results || []).map(r => r.name)
    .filter(n => /^\w+$/.test(n) && !/^(sqlite_|_cf_|d1_)/i.test(n) && !SKIP_TABLES.has(n));
}

/** { tables: [{ name, rows }] }: what the owner's full backup reads, table by table. */
async function tables(env) {
  const names = await tableNames(env);
  const counts = await env.DB.batch(names.map(n => env.DB.prepare(
    `SELECT COUNT(*) AS n FROM "${n}"${n === 'records' ? " WHERE coll <> 'er_conflict'" : ''}`)));
  return json({ ok: true, tables: names.map((name, i) => ({ name, rows: (counts[i].results[0] || {}).n || 0 })), skipped: [...SKIP_TABLES] });
}

const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

/** ?t=<table>&after=<rowid>: { cols, rows: [[rowid, ...values]], last, more }. Binary values as { b64 }. */
async function table(env, url) {
  const t = String(url.searchParams.get('t') || '');
  if (!(await tableNames(env)).includes(t)) return json({ error: 'bad_table' }, 400);
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  let res;
  try {
    res = await env.DB.prepare(
      `SELECT rowid AS __rowid, * FROM "${t}" WHERE rowid > ?1${t === 'records' ? " AND coll <> 'er_conflict'" : ''} ORDER BY rowid LIMIT ${TABLE_ROWS}`
    ).bind(after).all();
  } catch (err) {
    // A table without rowids (WITHOUT ROWID): all of it in one page.
    if (after) return json({ ok: true, cols: [], rows: [], last: after, more: false });
    res = await env.DB.prepare(`SELECT * FROM "${t}"`).all();
  }
  const list = res.results || [];
  const cols = list.length ? Object.keys(list[0]).filter(c => c !== '__rowid') : [];
  const rows = list.map(r => cols.map(c => (r[c] instanceof ArrayBuffer || ArrayBuffer.isView(r[c]) ? { b64: b64(r[c].buffer || r[c]) } : r[c])));
  const hasRowid = list.length && list[0].__rowid !== undefined;
  const last = hasRowid ? list[list.length - 1].__rowid : after;
  return json({ ok: true, cols, rows, last, more: !!hasRowid && list.length === TABLE_ROWS });
}
