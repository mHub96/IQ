/**
 * On-call status of a duty card and contact requests.
 *
 * The resident on duty (the card's own account) sets a status for today's card: in the operating
 * theatre, away for a consultation, or a custom one with a card skin. Colleagues who try to contact a
 * busy resident may leave a contact request instead: the holder is notified, sees the requests with
 * the requesters' contact buttons, and marks each one done; a request still open when the duty day
 * ends (08:00 Iraq time the next morning) becomes "missed".
 */

import { json, readJson, plainText, overLimit } from './lib.js';
import { nameKey, isoDate } from './names.js';
import { dutyDayNow } from './profile.js';
import { dispatchPush } from './accounts.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const SKINS = ['or', 'consult', 'gold', 'ocean', 'emerald', 'violet', 'night', 'rose'];
const IRAQ_OFFSET_MS = 3 * 3600 * 1000;

/**
 * The status options (the owner edits them: kv 'duty_status_options'). Each: { id, icon, label (on the
 * options), chip (on the card), skin, busy (contacting warns first) }. allowCustom: residents may also
 * write their own. autoClearHours: a status older than this is no longer shown (0 = never).
 */
export const DEFAULT_OPTIONS = {
  options: [
    { id: 'or', icon: '🩸', label: 'في صالة العمليات', chip: 'في العمليات', skin: 'or', busy: true },
    { id: 'consult', icon: '🚑', label: 'خارج القسم لاستشارة', chip: 'استشارة', skin: 'consult', busy: true },
  ],
  allowCustom: true,
  autoClearHours: 6,
};
export async function statusOptions(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'duty_status_options'").first();
  try {
    const v = JSON.parse((row && row.v) || 'null');
    if (v && Array.isArray(v.options)) return { ...DEFAULT_OPTIONS, ...v };
  } catch {}
  return DEFAULT_OPTIONS;
}
const OPT_ID = /^[a-z][a-z0-9_]{0,15}$/;
/** The owner's list, cleaned (unknown skins, empty labels and duplicate ids are dropped). */
function cleanOptions(body) {
  const seen = new Set();
  const options = (Array.isArray(body.options) ? body.options : []).slice(0, 12).map(o => ({
    id: String(o && o.id || '').toLowerCase(),
    icon: plainText(o && o.icon, 8) || '⏳',
    label: plainText(o && o.label, 40),
    chip: plainText(o && o.chip, 20) || plainText(o && o.label, 20),
    skin: SKINS.includes(o && o.skin) ? o.skin : 'night',
    busy: !(o && o.busy === false),
  })).filter(o => OPT_ID.test(o.id) && o.id !== 'custom' && o.label && !seen.has(o.id) && seen.add(o.id));
  const hours = Math.floor(Number(body.autoClearHours));
  return { options, allowCustom: body.allowCustom !== false, autoClearHours: Number.isFinite(hours) ? Math.max(0, Math.min(24, hours)) : DEFAULT_OPTIONS.autoClearHours };
}
/** Is this stored status still current (not older than the auto-clear time)? */
export const fresh = (row, opts, now) => !opts.autoClearHours || (now - row.updated_at) < opts.autoClearHours * 3600 * 1000;

/** The card of a duty (same as the likes and comments: duty:<hospital>:<date>:<name key>). */
function cardOf(h, d, n) {
  const hosp = String(h || '');
  const date = isoDate(d);
  const key = nameKey(n);
  if (!HOSP_RE.test(hosp) || !date || !key || String(n).length > 120) return null;
  return { target: `duty:${hosp}:${date}:${key}`, hosp, date, key, name: String(n).slice(0, 120) };
}

/** When a duty day ends: 08:00 Iraq time on the next calendar day (ms). */
export function dutyDayEnd(date) {
  const t = Date.parse(date + 'T08:00:00Z');
  return Number.isFinite(t) ? t + 24 * 3600 * 1000 - IRAQ_OFFSET_MS : 0;
}

export async function routeOnCall(path, method, request, env, auth, url, ctx) {
  switch (`${method} ${path}`) {
    case 'POST /api/duty-status': return setStatus(request, env, auth);
    case 'GET /api/duty-status/options': return auth ? json({ ok: true, ...(await statusOptions(env)) }) : json({ error: 'unauthorized' }, 401);
    case 'POST /api/duty-status/options': return saveOptions(request, env, auth);
    case 'GET /api/duty-status/today': return todayStatuses(env, auth, url);
    case 'GET /api/contact-requests': return listRequests(env, auth);
    case 'POST /api/contact-requests': return createRequest(request, env, auth, ctx);
    case 'POST /api/contact-requests/done': return markDone(request, env, auth);
    default: return null;
  }
}

/** The account's own name key (rotators keep theirs private: they hold no duty cards). */
async function ownKey(env, auth) {
  const row = await env.DB.prepare('SELECT name_key, role FROM accounts WHERE id = ?').bind(auth.a).first();
  return row && row.role !== 'rotator' ? row.name_key : null;
}

/** Body: { h, d, n, status: 'or'|'consult'|'custom'|'', skin, label }. Only the holder, on today's duty. */
async function setStatus(request, env, auth) {
  if (!auth || !auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  const card = cardOf(body.h, body.d, body.n);
  if (!card) return json({ error: 'bad_request' }, 400);
  if (card.key !== (await ownKey(env, auth))) return json({ error: 'not_your_card' }, 403);
  if (card.date !== dutyDayNow()) return json({ error: 'not_on_duty' }, 409);
  if (await overLimit(env, 'status:' + auth.a, 60)) return json({ error: 'rate_limited' }, 429);
  // The holder must really be on that hospital's roster today.
  const [dd, mm, yyyy] = [card.date.slice(8, 10), card.date.slice(5, 7), card.date.slice(0, 4)];
  const { results } = await env.DB.prepare(
    `SELECT json_extract(data, '$.name') AS n FROM records
      WHERE coll = 'sched' AND hosp = ?1 AND json_extract(data, '$.date') IN (?2, ?3, ?4)`
  ).bind(card.hosp, `${dd}/${mm}/${yyyy}`, `${Number(dd)}/${Number(mm)}/${yyyy}`, `${dd}/${Number(mm)}/${yyyy}`).all();
  if (!(results || []).some(r => nameKey(r.n) === card.key)) return json({ error: 'not_on_duty' }, 409);
  const status = String(body.status || '');
  if (!status) {
    await env.DB.prepare('DELETE FROM duty_status WHERE target = ?').bind(card.target).run();
    return json({ ok: true, status: null });
  }
  // One of the owner's options, or (if allowed) the resident's own text and skin.
  const opts = await statusOptions(env);
  const opt = opts.options.find(o => o.id === status);
  if (!opt && !(status === 'custom' && opts.allowCustom)) return json({ error: 'bad_status' }, 400);
  const skin = opt ? opt.skin : (SKINS.includes(body.skin) ? body.skin : 'night');
  const label = opt ? opt.chip : (plainText(body.label, 40) || 'مشغول');
  const icon = opt ? opt.icon : '⏳';
  await env.DB.prepare(
    `INSERT INTO duty_status (target, hosp, card_date, account_id, status, skin, label, icon, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (target) DO UPDATE SET account_id = excluded.account_id, status = excluded.status, skin = excluded.skin,
       label = excluded.label, icon = excluded.icon, updated_at = excluded.updated_at`
  ).bind(card.target, card.hosp, card.date, auth.a, status, skin, label, icon, Date.now()).run();
  return json({ ok: true, status: view({ status, skin, label, icon }, opts) });
}

/** A stored status as the cards show it: s (id), k (skin), l (text), i (icon), b (busy). */
function view(r, opts) {
  const opt = opts.options.find(o => o.id === r.status);
  return { s: r.status, k: r.skin, l: r.label || (opt ? opt.chip : ''), i: r.icon || (opt ? opt.icon : '⏳'), b: opt ? opt.busy !== false : true };
}

/** Body: { options, allowCustom, autoClearHours }. The owner only. */
async function saveOptions(request, env, auth) {
  if (!auth || auth.r !== 'owner') return json({ error: 'forbidden' }, 403);
  const body = await readJson(request) || {};
  const clean = cleanOptions(body);
  if (!clean.options.length && !clean.allowCustom) return json({ error: 'no_options' }, 400);
  await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('duty_status_options', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(clean)).run();
  return json({ ok: true, ...clean });
}

/** ?h=<hospital>: today's statuses of the hospital's duty cards (the residents page marks who is busy). */
async function todayStatuses(env, auth, url) {
  if (!auth) return json({ error: 'unauthorized' }, 401);
  // ?h=<hospital>[&h=<hospital>...] (the residents page asks for every hospital at once).
  const hosps = [...new Set(url.searchParams.getAll('h').map(String))].filter(h => HOSP_RE.test(h)).slice(0, 30);
  if (!hosps.length) return json({ error: 'bad_request' }, 400);
  const opts = await statusOptions(env);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT target, hosp, status, skin, label, icon, updated_at FROM duty_status WHERE card_date = ?1 AND hosp IN (SELECT value FROM json_each(?2))'
  ).bind(dutyDayNow(), JSON.stringify(hosps)).all();
  return json({ ok: true, statuses: (results || []).filter(r => fresh(r, opts, now)).map(r => ({ key: r.target.split(':').slice(3).join(':'), hosp: r.hosp, ...view(r, opts) })) });
}

/** Body: { h, d, n, note }. A colleague leaves a request for the card's holder (notified). */
async function createRequest(request, env, auth, ctx) {
  if (!auth || !auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  const card = cardOf(body.h, body.d, body.n);
  if (!card) return json({ error: 'bad_request' }, 400);
  if (card.date !== dutyDayNow()) return json({ error: 'not_on_duty' }, 409);
  if (card.key === (await ownKey(env, auth))) return json({ error: 'own_card' }, 400);
  if (await overLimit(env, 'creq:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);
  const open = await env.DB.prepare("SELECT id FROM contact_requests WHERE target = ? AND requester_id = ? AND status = 'pending'")
    .bind(card.target, auth.a).first();
  if (open) return json({ ok: true, id: open.id, already: true });
  const now = Date.now();
  const note = plainText(body.note, 200) || null;
  const ins = await env.DB.prepare(
    `INSERT INTO contact_requests (target, hosp, card_date, card_name, holder_key, requester_id, requester_name, note, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9) RETURNING id`
  ).bind(card.target, card.hosp, card.date, card.name, card.key, auth.a, auth.name || '', note, now).first();
  // The holder's accounts: one grouped notification per card (count of open requests).
  const res = await env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT a.id, ?1, 'contact_request', json_object('h', ?2, 'd', ?3, 'name', ?4, 'last', ?5,
            'count', (SELECT COUNT(*) FROM contact_requests WHERE target = ?6 AND status = 'pending')), ?7, 0
       FROM accounts a WHERE a.name_key = ?8 AND a.status = 'active' AND a.role <> 'rotator' AND a.id <> ?9
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     RETURNING account_id, type, data, gkey, ts`
  ).bind('creq:' + card.target, card.hosp, card.date, card.name, auth.name || '', card.target, now, card.key, auth.a).run();
  dispatchPush(env, ctx, res);
  return json({ ok: true, id: ins.id, notified: (res.results || []).length });
}

/** The holder's requests: open ones (requests of a finished duty day become missed), and the last 30 days. */
async function listRequests(env, auth) {
  if (!auth || !auth.a) return json({ error: 'account_required' }, 403);
  const key = await ownKey(env, auth);
  if (!key) return json({ ok: true, pending: [], past: [] });
  const now = Date.now();
  const { results: open } = await env.DB.prepare("SELECT id, card_date FROM contact_requests WHERE holder_key = ? AND status = 'pending'").bind(key).all();
  const missed = (open || []).filter(r => dutyDayEnd(r.card_date) && dutyDayEnd(r.card_date) <= now).map(r => r.id);
  if (missed.length) {
    await env.DB.prepare(`UPDATE contact_requests SET status = 'missed', updated_at = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'pending'`)
      .bind(JSON.stringify(missed), now).run();
  }
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.hosp, c.card_date, c.card_name, c.requester_id, c.requester_name, c.note, c.status, c.created_at, c.updated_at,
            a.phone AS requester_phone, a.avatar AS requester_avatar, a.sex AS requester_sex
       FROM contact_requests c LEFT JOIN accounts a ON a.id = c.requester_id
      WHERE c.holder_key = ?1 AND (c.status = 'pending' OR c.created_at > ?2)
      ORDER BY c.created_at DESC LIMIT 100`
  ).bind(key, now - 30 * 24 * 3600 * 1000).all();
  const view = r => ({
    id: r.id, hosp: r.hosp, date: r.card_date, name: r.card_name, by: r.requester_name, byPhone: r.requester_phone || '',
    note: r.note || '', status: r.status, at: r.created_at, updated: r.updated_at,
    avatar: (() => { try { return JSON.parse(r.requester_avatar || 'null'); } catch { return null; } })(), sex: r.requester_sex,
  });
  const all = (results || []).map(view);
  return json({ ok: true, pending: all.filter(r => r.status === 'pending'), past: all.filter(r => r.status !== 'pending') });
}

/** Body: { id }. The holder marks a request done. */
async function markDone(request, env, auth) {
  if (!auth || !auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  const key = await ownKey(env, auth);
  const res = await env.DB.prepare(
    "UPDATE contact_requests SET status = 'done', updated_at = ?3 WHERE id = ?1 AND holder_key = ?2 AND status IN ('pending', 'missed')"
  ).bind(Number(body.id) || 0, key || '', Date.now()).run();
  if (!res.meta.changes) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}

/** For the roster's summary (accounts.js socialSummary): statuses and open request counts of these cards. */
export async function cardStatuses(env, targets, myKey) {
  if (!targets.length) return new Map();
  const opts = await statusOptions(env);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT t.value AS target, s.status, s.skin, s.label, s.icon, s.updated_at,
            (SELECT COUNT(*) FROM contact_requests c WHERE c.target = t.value AND c.status = 'pending') AS waiting
       FROM json_each(?1) t LEFT JOIN duty_status s ON s.target = t.value`
  ).bind(JSON.stringify(targets)).all();
  const out = new Map();
  for (const r of results || []) {
    const mine = !!myKey && r.target.endsWith(':' + myKey);
    // A status older than the owner's auto-clear time is over.
    const live = r.status && fresh(r, opts, now);
    if (live || (mine && r.waiting)) out.set(r.target, { ...(live ? view(r, opts) : {}), ...(mine ? { w: r.waiting } : {}) });
  }
  return out;
}
