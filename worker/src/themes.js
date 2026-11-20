/**
 * Site themes ("skins"): the owner's theme packs (.hubtheme files).
 *
 * A theme is JSON: { format: 'hubtheme/1', id, name, name_en?, icon?, mode: 'light'|'dark', preview: {...},
 * tokens: { light: { '--ds-bg': ... }, dark: {...} }, css: '...', effects: [{ type, ... }] }. Only styles,
 * images (data: URIs) and the names of the site's built-in effects: no code.
 *
 * Stored in kv (additive keys only; nothing else in the database is touched):
 *   theme:<id>    the theme file
 *   themes_meta   { themes: [{ id, name, icon, preview, mode, start, end, v, size, notified }] }
 * mode: 'off' | 'owner' (the owner only) | 'optional' (every user may pick it in Settings) | 'forced'
 * (everyone sees it; their day / night switch follows the theme). start / end (ms, optional): the period
 * the mode applies; outside it the theme is off.
 *
 * Only the owner uploads, changes or deletes themes (personal owner account).
 */

import { json, readJson } from './lib.js';

const META = 'themes_meta';
const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const MODES = ['off', 'owner', 'optional', 'forced'];
const MAX_THEME_BYTES = 450 * 1024;
const MAX_THEMES = 60;

const isOwner = auth => !!auth && auth.r === 'owner';
// Reads kept to a minimum: the settings are read at most once per 5 minutes per data centre (memory, then
// the edge cache); each device also keeps them 10 minutes, and switches themes on and off at their times
// itself. Theme files are cached by version (read again only after the owner replaces them). The owner's
// changes refresh the cached copies at once (where the owner is; elsewhere within 5 minutes).
const BUCKET_MS = 5 * 60 * 1000;
const metaKey = b => new Request(`https://themes-cache.internal/meta/${b}`);
let memMeta = null;           // { b, meta } in this server instance
async function cachedMeta(env) {
  const b = Math.floor(Date.now() / BUCKET_MS);
  if (memMeta && memMeta.b === b) return memMeta.meta;
  try {
    const hit = await caches.default.match(metaKey(b));
    if (hit) { const meta = await hit.json(); memMeta = { b, meta }; return meta; }
  } catch {}
  return keepMeta(await readMeta(env));
}
async function keepMeta(meta) {
  const b = Math.floor(Date.now() / BUCKET_MS);
  memMeta = { b, meta };
  try { await caches.default.put(metaKey(b), new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${BUCKET_MS / 1000}` } })); } catch {}
  return meta;
}
const memFiles = new Map();   // 'id@v' -> theme
async function cachedFile(env, id, v) {
  const k = `${id}@${v}`;
  if (memFiles.has(k)) return memFiles.get(k);
  const req = new Request(`https://themes-cache.internal/file/${encodeURIComponent(k)}`);
  let theme = null;
  try { const hit = await caches.default.match(req); if (hit) theme = await hit.json(); } catch {}
  if (!theme) {
    const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('theme:' + id).first();
    try { theme = JSON.parse((row && row.v) || 'null'); } catch { theme = null; }
    if (theme) { try { await caches.default.put(req, new Response(JSON.stringify(theme), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=2592000' } })); } catch {} }
  }
  if (theme) { if (memFiles.size > 20) memFiles.clear(); memFiles.set(k, theme); }
  return theme;
}

async function readMeta(env) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(META).first();
  try { const m = JSON.parse((row && row.v) || '{}'); return Array.isArray(m.themes) ? m : { themes: [] }; } catch { return { themes: [] }; }
}
function writeMeta(env, meta) {
  return env.DB.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(META, JSON.stringify(meta));
}

/** Is the theme's mode in force now (inside its period, when it has one)? */
const inPeriod = (t, now) => (!t.start || t.start <= now) && (!t.end || now < t.end);

/**
 * A theme's CSS may hold styles only: no imports, scripts, expressions, bindings or outside addresses
 * (images and fonts as data: URIs). Returns an error code or null.
 */
export function cssProblem(css) {
  const s = String(css || '');
  if (/<\/?\s*(style|script)/i.test(s)) return 'css_tag';
  if (/@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@namespace/i.test(s)) return 'css_unsafe';
  const urls = s.match(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi) || [];
  for (const u of urls) {
    const m = /url\(\s*(['"]?)([^'")]*)\1\s*\)/i.exec(u);
    if (!m || !/^data:(image\/(png|jpe?g|gif|webp|svg\+xml)|font\/(woff2?|ttf|otf)|application\/font-woff2?)[;,]/i.test(m[2].trim())) return 'css_url';
  }
  return null;
}

const EFFECTS = ['snow', 'rain', 'lightning', 'wind', 'fireworks', 'confetti', 'hearts', 'lanterns', 'stars', 'leaves',
  'petals', 'balloons', 'bubbles', 'embers', 'dust', 'fog', 'sunrays', 'aurora', 'particles', 'glow', 'crescent', 'butterflies'];

/** Checks an uploaded theme; returns { theme } (cleaned) or { error }. */
function cleanTheme(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: 'bad_theme' };
  if (t.format !== 'hubtheme/1') return { error: 'bad_format' };
  const id = String(t.id || '').toLowerCase();
  if (!ID_RE.test(id)) return { error: 'bad_id' };
  const name = String(t.name || '').trim().slice(0, 60);
  if (!name) return { error: 'no_name' };
  const tokens = {};
  for (const scheme of ['light', 'dark']) {
    const src = t.tokens && t.tokens[scheme];
    if (!src) continue;
    if (typeof src !== 'object') return { error: 'bad_tokens' };
    tokens[scheme] = {};
    for (const [k, v] of Object.entries(src)) {
      if (!/^--[a-z0-9-]{1,40}$/i.test(k) || typeof v !== 'string' || v.length > 4000) return { error: 'bad_tokens' };
      const p = cssProblem(`a{${k}:${v}}`);
      if (p || /[{};]/.test(v.replace(/url\([^)]*\)/g, ''))) return { error: p || 'bad_tokens' };
      tokens[scheme][k] = v;
    }
  }
  const css = String(t.css || '');
  const problem = cssProblem(css);
  if (problem) return { error: problem };
  const effects = Array.isArray(t.effects) ? t.effects : [];
  if (effects.length > 8 || effects.some(e => !e || typeof e !== 'object' || !EFFECTS.includes(e.type))) return { error: 'bad_effects' };
  if (JSON.stringify(effects).length > 120 * 1024) return { error: 'too_big' };
  const effectsSafe = JSON.stringify(effects);
  if (/javascript:|<script/i.test(effectsSafe)) return { error: 'bad_effects' };
  const theme = {
    format: 'hubtheme/1', id, name,
    name_en: String(t.name_en || '').slice(0, 60),
    icon: String(t.icon || '🎨').slice(0, 8),
    description: String(t.description || '').slice(0, 300),
    mode: t.mode === 'light' ? 'light' : 'dark',
    preview: t.preview && typeof t.preview === 'object' ? Object.fromEntries(Object.entries(t.preview).filter(([k, v]) => /^[a-z0-9]{1,16}$/i.test(k) && typeof v === 'string' && v.length < 200 && !cssProblem(`a{b:${v}}`))) : {},
    tokens, css, effects,
  };
  const size = JSON.stringify(theme).length;
  if (size > MAX_THEME_BYTES) return { error: 'too_big' };
  return { theme, size };
}

const summary = t => ({ id: t.id, name: t.name, icon: t.icon, preview: t.preview || {}, mode: t.mode, start: t.start || null, end: t.end || null, v: t.v, scheme: t.scheme || 'dark', size: t.size || 0 });

/** Everyone: the themes in force (forced / optional, and the owner's own for the owner). Cached a minute. */
async function state(env, auth) {
  const now = Date.now();
  const meta = await cachedMeta(env);
  // Themes whose period has not ended (the page switches them on and off at their times itself).
  const live = meta.themes.filter(t => (t.mode === 'forced' || t.mode === 'optional' || (t.mode === 'owner' && isOwner(auth))) && (!t.end || now < t.end));
  return json({ ok: true, now, themes: live.map(summary) });
}

/** A theme file (in force for this user, or the owner). */
async function file(env, auth, url) {
  const id = String(url.searchParams.get('id') || '');
  if (!ID_RE.test(id)) return json({ error: 'bad_request' }, 400);
  const meta = await cachedMeta(env);
  const m = meta.themes.find(t => t.id === id);
  if (!m) return json({ error: 'not_found' }, 404);
  if (!isOwner(auth) && !['forced', 'optional'].includes(m.mode)) return json({ error: 'forbidden' }, 403);
  const theme = await cachedFile(env, id, m.v);
  if (!theme) return json({ error: 'not_found' }, 404);
  return json({ ok: true, theme, v: m.v });
}

/** Owner: every theme with its settings. */
async function list(env) {
  const meta = await readMeta(env);
  return json({ ok: true, themes: meta.themes.map(t => ({ ...summary(t), notified: t.notified || null })), now: Date.now() });
}

/** Owner: upload (or replace) a theme. Body: { theme }. A new theme starts switched off. */
async function upload(request, env) {
  const body = await readJson(request) || {};
  const { theme, size, error } = cleanTheme(body.theme);
  if (error) return json({ error }, 400);
  const meta = await readMeta(env);
  const old = meta.themes.find(t => t.id === theme.id);
  if (!old && meta.themes.length >= MAX_THEMES) return json({ error: 'too_many' }, 409);
  const v = Date.now();
  const entry = { ...(old || { mode: 'off', start: null, end: null }), id: theme.id, name: theme.name, icon: theme.icon, preview: theme.preview, scheme: theme.mode, v, size };
  meta.themes = old ? meta.themes.map(t => (t.id === theme.id ? entry : t)) : [...meta.themes, entry];
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind('theme:' + theme.id, JSON.stringify(theme)),
    writeMeta(env, meta),
  ]);
  await keepMeta(meta);
  return json({ ok: true, theme: summary(entry), replaced: !!old });
}

/** Tells every active account that a theme can be picked in Settings (once per theme and period). */
async function notifyAll(env, t, now) {
  const data = JSON.stringify({ id: t.id, name: t.name, icon: t.icon || '🎨' });
  await env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT id, ?1, 'theme_new', ?2, ?3, 0 FROM accounts WHERE status = 'active' AND true
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0`
  ).bind('theme:' + t.id + ':' + (t.start || t.v), data, now).run();
}

/** Owner: a theme's mode and period. Body: { id, mode, start?, end? } (ms or null). */
async function settings(request, env, ctx) {
  const body = await readJson(request) || {};
  const id = String(body.id || '');
  if (!ID_RE.test(id) || !MODES.includes(body.mode)) return json({ error: 'bad_request' }, 400);
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const start = num(body.start), end = num(body.end);
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)) || (start && end && end <= start)) return json({ error: 'bad_period' }, 400);
  const meta = await readMeta(env);
  const t = meta.themes.find(x => x.id === id);
  if (!t) return json({ error: 'not_found' }, 404);
  // A forced theme is one at a time: another forced theme whose period overlaps goes back to optional.
  if (body.mode === 'forced') {
    meta.themes.forEach(o => {
      if (o.id === id || o.mode !== 'forced') return;
      const overlap = (!o.end || !start || start < o.end) && (!end || !o.start || o.start < end);
      if (overlap) o.mode = 'off';
    });
  }
  const periodChanged = t.start !== start || t.end !== end;
  t.mode = body.mode; t.start = start; t.end = end;
  if (periodChanged || body.mode !== 'optional') t.notified = null;
  const now = Date.now();
  // Optional now: everyone is told at once (a later start is told by the 10-minute job).
  const tell = t.mode === 'optional' && !t.notified && inPeriod(t, now);
  if (tell) t.notified = now;
  await writeMeta(env, meta).run();
  await keepMeta(meta);
  if (tell) {
    const job = notifyAll(env, t, now).catch(err => console.error('theme notify', err && err.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  }
  return json({ ok: true, themes: meta.themes.map(summary), notified: tell });
}

/** Owner: delete a theme (its file and its settings). */
async function remove(request, env) {
  const body = await readJson(request) || {};
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return json({ error: 'bad_request' }, 400);
  const meta = await readMeta(env);
  meta.themes = meta.themes.filter(t => t.id !== id);
  await env.DB.batch([env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('theme:' + id), writeMeta(env, meta)]);
  await keepMeta(meta);
  return json({ ok: true });
}

/** The 10-minute job: an optional theme whose period has just started tells everyone. One kv read. */
export async function themesTick(env) {
  // The cached copy first (no read when nothing is due); the stored one only to write.
  const now = Date.now();
  const cached = await cachedMeta(env);
  if (!cached.themes.some(t => t.mode === 'optional' && !t.notified && inPeriod(t, now))) return;
  const meta = await readMeta(env);
  const due = meta.themes.filter(t => t.mode === 'optional' && !t.notified && inPeriod(t, now));
  if (!due.length) return;
  due.forEach(t => { t.notified = now; });
  await writeMeta(env, meta).run();
  await keepMeta(meta);
  for (const t of due) await notifyAll(env, t, now);
}

export async function routeThemes(path, method, request, env, auth, url, ctx) {
  if (!/^\/api\/themes(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (path === '/api/themes/state' && method === 'GET') return state(env, auth);
  if (path === '/api/themes/file' && method === 'GET') return file(env, auth, url);
  // Everything else is the owner's (a personal owner account, not a view-as session).
  if (!isOwner(auth) || auth.vo) return json({ error: 'forbidden' }, 403);
  switch (`${method} ${path}`) {
    case 'GET /api/themes': return list(env);
    case 'POST /api/themes': return upload(request, env);
    case 'POST /api/themes/settings': return settings(request, env, ctx);
    case 'POST /api/themes/delete': return remove(request, env);
  }
  return json({ error: 'not_found' }, 404);
}
