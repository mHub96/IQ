/**
 * Fonts for the ER page's printed sheets: uploaded once, shared by everyone who prints there, kept
 * until deleted (table er_fonts).
 *
 * The font travels and is stored as base64 text, and the browser turns it back into a font
 * (FontFace): the Worker only passes the text through, so a large font costs it no CPU time.
 *
 *   GET  /api/er-fonts                 the list (owner and admins)
 *   POST /api/er-fonts {name, file, data}   upload; data = the file in base64 (owner and admins)
 *   POST /api/er-fonts/delete {id}     delete (owner and admins)
 *   GET  /api/er-fonts/file/<id>       the font's base64 text, public and cached for good (the
 *                                      id is random; fonts are not private)
 */
import { json } from './lib.js';
import { canUseEr } from './eraccess.js';

const MAX_BYTES = 1400 * 1024;                  // base64 of it stays under D1's 2 MB per value
const MAX_FONTS = 60;


/** The file's format from its first bytes (the name alone is not trusted). */
function sniff(b64) {
  let head;
  try { head = atob(b64.slice(0, 16)); } catch { return null; }
  const tag = head.slice(0, 4);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || tag === '\u0000\u0001\u0000\u0000') return 'truetype';
  return null;
}

const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>"'`\\]/g, '').trim().slice(0, max);

export async function routeErFonts(path, method, request, env, auth) {
  if (!path.startsWith('/api/er-fonts')) return null;

  const file = path.match(/^\/api\/er-fonts\/file\/([a-f0-9]{24})$/);
  if (file && method === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM er_fonts WHERE id = ?').bind(file[1]).first();
    if (!row) return new Response('not found', { status: 404 });
    return new Response(row.data, { headers: { 'Content-Type': 'text/plain; charset=us-ascii', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }
  if (file) return json({ error: 'not_found' }, 404);

  if (!auth || !(await canUseEr(env, auth))) return json({ error: 'forbidden' }, auth ? 403 : 401);

  if (path === '/api/er-fonts' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, file_name, format, size, created_by, created_at FROM er_fonts ORDER BY created_at'
    ).all();
    return json({ fonts: results || [] });
  }

  if (path === '/api/er-fonts' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
    const data = String(body && body.data || '').replace(/\s+/g, '');
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return json({ error: 'bad_request' }, 400);
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (size > MAX_BYTES) return json({ error: 'too_large', max: MAX_BYTES }, 413);
    const format = sniff(data);
    if (!format) return json({ error: 'not_a_font' }, 400);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM er_fonts').first();
    if (count && count.n >= MAX_FONTS) return json({ error: 'too_many', max: MAX_FONTS }, 409);
    const fileName = clean(body.file, 120) || 'font';
    const name = clean(body.name, 60) || fileName.replace(/\.(ttf|otf|woff2?)$/i, '');
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now();
    const by = auth.a ? `${auth.r}:${auth.name}` : auth.r;
    await env.DB.prepare(
      'INSERT INTO er_fonts (id, name, file_name, format, size, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, fileName, format, size, data, by, now).run();
    return json({ font: { id, name, file_name: fileName, format, size, created_by: by, created_at: now } });
  }

  if (path === '/api/er-fonts/delete' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
    const id = String(body && body.id || '');
    if (!/^[a-f0-9]{24}$/.test(id)) return json({ error: 'bad_request' }, 400);
    const r = await env.DB.prepare('DELETE FROM er_fonts WHERE id = ?').bind(id).run();
    return json({ ok: true, deleted: (r.meta && r.meta.changes) || 0 });
  }

  return json({ error: 'not_found' }, 404);
}
