/**
 * Personal accounts: sign-up checked against the roster, approval by the owner or the hospital's
 * admins, sign-in with an optional device limit, approved password resets, settings (anonymous
 * nickname, language), notifications with Web Push, and likes / comments on duty cards.
 *
 * Password handling: the browser sends `key` = base64(PBKDF2-SHA256(password, "hosp-hub/v1/" +
 * username, 310 000 rounds)). The slow part therefore runs on the phone, which keeps the Worker
 * inside the free plan's 10 ms CPU budget; the server stores SHA-256(salt || key) with a random salt.
 */

import { DAY, json, readJson, signToken, sha256b64, b64, overLimit, bucketOf, plainText } from './lib.js';
import { nameKey, namesMatch, phoneKey, isoDate } from './names.js';
import { sendPush, isPushEndpoint, topicFor } from './push.js';
import { BOARDS, dutyDayNow, getStageMonth, setStageMonth, currentStage, profileComplete, suggestProfile } from './profile.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,23}$/;
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes, base64
const HOSP_RE = /^[\w-]{1,48}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ACCOUNT_ROLES = ['user', 'anaesthesia', 'admin', 'owner'];
const RESET_VALID_MS = 3 * DAY;
const ACTIVE_WRITE_MS = 60 * 60 * 1000; // last_seen is refreshed at most hourly (D1 write budget)
const PUBLIC_FIELDS = `id, username, name, phone, sex, hosp, resident_id, role, hospitals, status, max_devices,
  anon_tag, anon_lang, reset, reset_at, created_at, decided_at, decided_by, last_seen,
  board, specialty, stage, stage_ref, board_years, profile_src`;

/** Routes under /api/accounts, /api/notifications, /api/social and /api/push. Returns null when not matched. */
export async function routeAccounts(path, method, request, env, auth, url, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  switch (`${method} ${path}`) {
    case 'POST /api/accounts/check': return checkIdentity(request, env, ip);
    case 'GET /api/accounts/username': return usernameFree(env, url, ip);
    case 'POST /api/accounts/signup': return signup(request, env, ip, ctx);
    case 'POST /api/accounts/login': return accountLogin(request, env, ip);
    case 'POST /api/accounts/forgot': return forgot(request, env, ip, ctx);
    case 'POST /api/accounts/reset': return resetPassword(request, env, ip);
    case 'GET /api/social': return socialSummary(env, auth, url);
    case 'GET /api/push/key': return json({ ok: true, key: env.VAPID_PUBLIC || null });
  }
  if (!/^\/api\/(accounts|notifications|social|push)(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/accounts/me': return me(env, auth);
    case 'POST /api/accounts/password': return changePassword(request, env, auth);
    case 'GET /api/accounts/anon-check': return anonCheck(env, auth, url);
    case 'GET /api/accounts/profile-suggest': return profileSuggest(env, auth);
    case 'POST /api/accounts/profile': return saveProfile(request, env, auth);
    case 'GET /api/accounts/received': return receivedComments(env, auth, url);
    case 'GET /api/accounts/stage-month': return json({ ok: true, month: await getStageMonth(env) });
    case 'POST /api/accounts/stage-month': return putStageMonth(request, env, auth);
    case 'POST /api/accounts/anon': return setAnon(request, env, auth);
    case 'POST /api/accounts/devices/remove': return removeOwnDevice(request, env, auth);
    case 'GET /api/accounts': return listAccounts(env, auth, url);
    case 'POST /api/accounts/decide': return decide(request, env, auth, ctx);
    case 'GET /api/notifications': return listNotifications(env, auth, url);
    case 'POST /api/notifications/seen': return markSeen(request, env, auth);
    case 'GET /api/social/thread': return thread(env, auth, url);
    case 'GET /api/social/recent': return recentComments(env, auth, url);
    case 'POST /api/social/like': return like(request, env, auth, ctx);
    case 'POST /api/social/comment': return addComment(request, env, auth, ctx);
    case 'POST /api/social/comment/delete': return deleteComment(request, env, auth);
    case 'POST /api/social/comment/edit': return editComment(request, env, auth);
    case 'POST /api/push/subscribe': return pushSubscribe(request, env, auth);
    case 'POST /api/push/unsubscribe': return pushUnsubscribe(request, env, auth);
    case 'POST /api/push/test': return pushTest(env, auth, ctx);
  }
  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------------
// Tokens for accounts
// ---------------------------------------------------------------------------

export function scopeOf(row) {
  if (row.role === 'owner') return ['*'];
  if (row.role === 'user') return [];
  try { return JSON.parse(row.hospitals || '[]'); } catch { return []; }
}

async function issueAccountToken(env, row, deviceId, remember) {
  const exp = Date.now() + (remember === false ? DAY : 30 * DAY);
  const payload = { r: row.role, h: scopeOf(row), e: exp, a: row.id, s: row.sess, dv: deviceId };
  return { token: await signToken(env, payload), exp };
}

/**
 * Called by authenticate() for tokens that carry an account id. Role and hospitals always come
 * from the database, so approvals, promotions, bans and removed devices take effect immediately.
 */
export async function resolveAccountAuth(env, payload) {
  const row = await env.DB.prepare(
    `SELECT a.id, a.role, a.hospitals, a.status, a.sess, a.name, a.hosp, a.anon_tag, d.device_id AS dev
       FROM accounts a LEFT JOIN account_devices d ON d.account_id = a.id AND d.device_id = ?2
      WHERE a.id = ?1`
  ).bind(payload.a, payload.dv || '').first();
  if (!row || row.status !== 'active' || row.sess !== payload.s || !row.dev) return null;
  return { r: row.role, h: scopeOf(row), e: payload.e, a: row.id, name: row.name, hosp: row.hosp, anon: row.anon_tag, dv: payload.dv };
}

function profile(row, stageMonth = 10) {
  if (!row) return null;
  const { pw, salt, anon_key, devices, ...rest } = row;
  const out = { ...rest, hospitals: scopeOf(row) };
  if ('board' in row) {
    out.stage_now = currentStage(row.stage, row.stage_ref, row.board_years, stageMonth);
    out.profile_complete = profileComplete(row);
    out.stage_month = stageMonth;
  }
  if (devices !== undefined) {
    try { out.devices = JSON.parse(devices || '[]'); } catch { out.devices = []; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anonymous nicknames (Reddit style: Adjective-Noun-1234), by sex and language
// ---------------------------------------------------------------------------

const NICK = {
  en: {
    adj: ['Brave', 'Calm', 'Swift', 'Silent', 'Bright', 'Gentle', 'Clever', 'Bold', 'Lucky', 'Noble', 'Quiet', 'Witty',
      'Wise', 'Sunny', 'Steady', 'Keen', 'Kind', 'Proud', 'Mighty', 'Cosmic', 'Golden', 'Silver', 'Misty', 'Breezy'],
    m: ['Falcon', 'Lion', 'Wolf', 'Tiger', 'Eagle', 'Hawk', 'Bear', 'Stallion', 'Knight', 'Panther', 'Fox', 'Bison',
      'Raven', 'Shark', 'Leopard', 'Rhino', 'Ram', 'Gorilla', 'Prince', 'Captain', 'Viking', 'Samurai', 'Pharaoh', 'Sultan'],
    f: ['Lioness', 'Gazelle', 'Dove', 'Swan', 'Mare', 'Doe', 'Pearl', 'Lily', 'Butterfly', 'Rose', 'Heron', 'Jasmine',
      'Tigress', 'Duchess', 'Princess', 'Queen', 'Empress', 'Orchid', 'Daisy', 'Violet', 'Sparrow', 'Robin', 'Luna', 'Stella'],
  },
  ar: {
    m: [['صقر', 'شجاع'], ['أسد', 'هادئ'], ['ذئب', 'سريع'], ['نمر', 'حكيم'], ['نسر', 'لامع'], ['فهد', 'صبور'], ['شاهين', 'نبيل'],
      ['حصان', 'جريء'], ['فارس', 'ذكي'], ['باز', 'كريم'], ['دب', 'وفي'], ['ثعلب', 'مرح'], ['حوت', 'أنيق'], ['دلفين', 'قوي'],
      ['نجم', 'رزين'], ['قمر', 'سعيد'], ['جبل', 'ذهبي'], ['برق', 'فضي'], ['بحر', 'هادر'], ['سيف', 'لامع']],
    f: [['غزالة', 'شجاعة'], ['لبؤة', 'هادئة'], ['حمامة', 'سريعة'], ['فراشة', 'حكيمة'], ['مهرة', 'لامعة'], ['نجمة', 'صبورة'],
      ['لؤلؤة', 'نبيلة'], ['وردة', 'جريئة'], ['ياسمينة', 'ذكية'], ['زهرة', 'كريمة'], ['نسمة', 'وفية'], ['شمس', 'مرحة'],
      ['سنبلة', 'أنيقة'], ['موجة', 'قوية'], ['قمرية', 'رزينة'], ['فرسة', 'سعيدة'], ['نخلة', 'ذهبية'], ['غيمة', 'فضية']],
  },
};
const ADJ_M_AR = NICK.ar.m.map(x => x[1]);
const ADJ_F_AR = NICK.ar.f.map(x => x[1]);

const pick = list => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
const num4 = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));

export function randomNick(sex, lang) {
  const s = sex === 'f' ? 'f' : 'm';
  if (lang === 'en') return `${pick(NICK.en.adj)}-${pick(NICK.en[s])}-${num4()}`;
  const noun = pick(NICK.ar[s])[0];
  const adj = pick(s === 'f' ? ADJ_F_AR : ADJ_M_AR);
  return `${noun}-${adj}-${num4()}`;
}

/** Duplicate check key: case, Arabic letter variants and separators do not make a nickname different. */
export function nickKey(tag) {
  return String(tag || '')
    .normalize('NFKC').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[\s._-]+/g, '');
}

const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,23}$/u;
const RESERVED = /^(admin|owner|moderator|mod|system|support|dr|doctor|مالك|المالك|مدير|المدير|مشرف|ادمن|دكتور|د)(?![\p{L}])/u;

function nickProblem(tag) {
  const t = String(tag || '').trim();
  if (!NICK_RE.test(t)) return 'invalid';
  if (RESERVED.test(nickKey(t)) || RESERVED.test(t.toLowerCase())) return 'reserved';
  return null;
}

/** Inserts with a fresh random nickname, retrying if one is already taken. */
async function withUniqueNick(sex, lang, attempt) {
  for (let i = 0; i < 6; i++) {
    const tag = randomNick(sex, lang);
    try {
      return await attempt(tag, nickKey(tag));
    } catch (err) {
      if (!/anon_key/.test(String(err && err.message))) throw err;
    }
  }
  throw new Error('nickname_space_exhausted');
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

/** Finds the roster entry for a hospital + name + phone. Never tells which part did not match. */
async function findResident(env, hosp, name, phone) {
  const pk = phoneKey(phone);
  if (!pk || !HOSP_RE.test(hosp) || !name) return { hospOk: false, match: null };
  const cleanPhone = expr => `replace(replace(replace(COALESCE(${expr}, ''), ' ', ''), '-', ''), '+', '')`;
  const [hospRow, residents, names] = await env.DB.batch([
    env.DB.prepare("SELECT 1 AS ok FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
    env.DB.prepare(
      `SELECT id, json_extract(data, '$.name') AS name, json_extract(data, '$.phone') AS phone, json_extract(data, '$.hospitals') AS hospitals
         FROM records WHERE coll = 'resident' AND ${cleanPhone("json_extract(data, '$.phone')")} LIKE '%' || ?1`
    ).bind(pk),
    env.DB.prepare(
      `SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.name') AS name, json_extract(j.value, '$.phone') AS phone
         FROM records r, json_each(r.data, '$.names') j
        WHERE r.coll = 'hospital' AND r.id = ?2 AND ${cleanPhone("json_extract(j.value, '$.phone')")} LIKE '%' || ?1`
    ).bind(pk, hosp),
  ]);
  if (!hospRow.results.length) return { hospOk: false, match: null };
  const inHospital = r => {
    try { return (JSON.parse(r.hospitals || '[]') || []).includes(hosp); } catch { return false; }
  };
  const candidates = [...names.results, ...residents.results.filter(inHospital)];
  const match = candidates.find(c => phoneKey(c.phone) === pk && namesMatch(name, c.name)) || null;
  return { hospOk: true, match, pk };
}

async function checkIdentity(request, env, ip) {
  if (await overLimit(env, 'check:' + ip, 60)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const { hospOk, match } = await findResident(env, String(body.hosp || ''), String(body.name || ''), String(body.phone || ''));
  if (!hospOk || !match) return json({ ok: true, match: false });
  const taken = await env.DB.prepare("SELECT 1 AS t FROM accounts WHERE resident_id = ? AND status IN ('pending', 'active')").bind(match.id || '').first();
  const hint = taken ? {} : await suggestProfile(env, { name: match.name, hosp: String(body.hosp), residentId: match.id, phone: body.phone }).catch(() => ({}));
  return json({ ok: true, match: true, taken: !!taken, name: match.name, sex: hint.sex || null });
}

async function usernameFree(env, url, ip) {
  if (await overLimit(env, 'uname:' + ip, 120)) return json({ error: 'rate_limited' }, 429);
  const u = String(url.searchParams.get('u') || '').trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return json({ ok: true, valid: false, free: false });
  const row = await env.DB.prepare('SELECT 1 AS t FROM accounts WHERE username = ?').bind(u).first();
  return json({ ok: true, valid: true, free: !row });
}

async function signup(request, env, ip, ctx) {
  if (await overLimit(env, 'signup:' + ip, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  const hosp = String(body.hosp || '');
  const sex = body.sex === 'f' ? 'f' : body.sex === 'm' ? 'm' : null;
  const lang = body.lang === 'en' ? 'en' : 'ar';
  if (!sex) return json({ error: 'bad_sex' }, 400);
  if (!USERNAME_RE.test(username)) return json({ error: 'bad_username' }, 400);
  if (!KEY_RE.test(key)) return json({ error: 'bad_key' }, 400);

  const { hospOk, match, pk } = await findResident(env, hosp, String(body.name || ''), String(body.phone || ''));
  if (!hospOk || !match) return json({ error: 'no_match' }, 400);

  const now = Date.now();
  const id = crypto.randomUUID();
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const pw = await sha256b64(salt + key);
  const note = JSON.stringify({ id, name: match.name, username, hosp });
  // Profile filled in from the roster and the ER scheduler; the user confirms or edits it later.
  const auto = await suggestProfile(env, { name: match.name, hosp, residentId: match.id, phone: pk }).catch(() => ({}));
  try {
    const results = await withUniqueNick(sex, lang, (tag, tagKey) => env.DB.batch([
      env.DB.prepare(
        `INSERT INTO accounts (id, username, pw, salt, name, name_key, phone, sex, hosp, resident_id, anon_tag, anon_key, anon_lang, created_at,
                               board, specialty, stage, stage_ref, profile_src)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, username, pw, salt, match.name, nameKey(match.name), pk, sex, hosp, match.id || null, tag, tagKey, lang, now,
        auto.board || null, auto.specialty || null, auto.stage ?? null, auto.stage != null ? now : null, auto.source && auto.source.length ? 'auto' : null),
      notifyApprovers(env, hosp, 'signup:' + id, 'signup_request', note, now),
    ]));
    dispatchPush(env, ctx, results[1]);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/accounts\.username/.test(msg)) return json({ error: 'username_taken' }, 409);
    if (/resident_id|idx_accounts_resident/.test(msg)) return json({ error: 'already_registered' }, 409);
    throw err;
  }
  return json({ ok: true, status: 'pending', name: match.name });
}

// ---------------------------------------------------------------------------
// Notifications (stored rows + Web Push)
// ---------------------------------------------------------------------------

const RETURNING = 'RETURNING account_id, type, data, gkey';

/** Notification for every active owner account and every admin account of `hosp`. */
function notifyApprovers(env, hosp, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT id, ?1, ?2, ?3, ?4, 0 FROM accounts
      WHERE status = 'active' AND (role = 'owner' OR (role = 'admin' AND EXISTS (
            SELECT 1 FROM json_each(accounts.hospitals) WHERE value IN (?5, '*'))))
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(gkey, type, data, now, hosp);
}

function notifyOne(env, accountId, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen) VALUES (?1, ?2, ?3, ?4, ?5, 0)
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(accountId, gkey, type, data, now);
}

const ROLE_AR = { owner: 'المالك', admin: 'مدير مستشفى', anaesthesia: 'مقيم تخدير', user: 'مقيم' };

/** Lock-screen text for one notification row (the in-app list builds its own, richer text). */
function pushMessage(n) {
  let d = {};
  try { d = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data || {}); } catch {}
  const others = d.count > 1 ? ` و${d.count - 1} آخرين` : '';
  const card = d.h ? `./Home.html?hospital=${encodeURIComponent(d.h)}#thread=${encodeURIComponent(d.d || '')}|${encodeURIComponent(d.name || '')}` : './Home.html';
  switch (n.type) {
    case 'like': return { title: '❤️ إعجاب جديد', body: `${d.last || 'أحدهم'}${others} أُعجب ببطاقة خفارتك`, url: card };
    case 'comment': return { title: '💬 تعليق جديد على بطاقتك', body: `${d.last || 'أحدهم'}: ${d.text || ''}`, url: card };
    case 'signup_request': return { title: '🆕 طلب حساب جديد', body: `${d.name || ''} (@${d.username || ''})`, url: './account.html#manage' };
    case 'reset_request': return { title: '🔑 طلب تغيير كلمة المرور', body: `${d.name || ''} (@${d.username || ''})`, url: './account.html#manage-resets' };
    case 'account_approved': return { title: '✅ تم تفعيل حسابك', body: 'أهلاً بك في بوابة المستشفيات!', url: './index.html?portal=true' };
    case 'reset_approved': return { title: '🔓 تمت الموافقة', body: 'يمكنك الآن اختيار كلمة مرور جديدة.', url: './account.html#forgot' };
    case 'role_changed': return { title: '⭐ تغيّرت صلاحياتك', body: `صلاحيتك الآن: ${ROLE_AR[d.role] || d.role || ''}`, url: './account.html' };
    default: return { title: '🔔 إشعار جديد', body: '', url: './index.html?portal=true' };
  }
}

/** Sends a push for every notification row returned by an INSERT ... RETURNING, after the response. */
function dispatchPush(env, ctx, ...stmtResults) {
  const rows = stmtResults.flatMap(r => (r && r.results) || []);
  if (!rows.length || !env.VAPID_PRIVATE) return;
  const job = (async () => {
    const ids = [...new Set(rows.map(r => r.account_id))];
    const { results: subs } = await env.DB.prepare(
      'SELECT endpoint, account_id, p256dh, auth FROM push_subs WHERE account_id IN (SELECT value FROM json_each(?))'
    ).bind(JSON.stringify(ids)).all();
    const gone = [];
    await Promise.all(rows.flatMap(row => subs.filter(s => s.account_id === row.account_id).map(async s => {
      try {
        const msg = { ...pushMessage(row), tag: row.gkey };
        const status = await sendPush(env, s, msg, { topic: await topicFor(row.gkey), urgency: row.type === 'like' ? 'low' : 'normal' });
        if (status === 404 || status === 410) gone.push(s.endpoint);
      } catch (err) {
        console.warn('push failed', err && err.message);
      }
    })));
    if (gone.length) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint IN (SELECT value FROM json_each(?))').bind(JSON.stringify(gone)).run();
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
}

async function pushSubscribe(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request);
  const sub = body && body.subscription;
  const endpoint = sub && String(sub.endpoint || '');
  const keys = (sub && sub.keys) || {};
  if (!isPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth || '')) {
    return json({ error: 'bad_subscription' }, 400);
  }
  await env.DB.batch([
    // One subscription per device: replace the device's previous one.
    env.DB.prepare('DELETE FROM push_subs WHERE account_id = ? AND device_id = ? AND endpoint <> ?').bind(auth.a, auth.dv || '', endpoint),
    env.DB.prepare(
      `INSERT INTO push_subs (endpoint, account_id, device_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET account_id = excluded.account_id, device_id = excluded.device_id,
         p256dh = excluded.p256dh, auth = excluded.auth`
    ).bind(endpoint, auth.a, auth.dv || null, keys.p256dh, keys.auth, Date.now()),
  ]);
  return json({ ok: true });
}

async function pushUnsubscribe(request, env, auth) {
  const body = await readJson(request) || {};
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND account_id = ?').bind(String(body.endpoint || ''), auth.a || '').run();
  return json({ ok: true });
}

async function pushTest(env, auth, ctx) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'pushtest:' + auth.a, 5)) return json({ error: 'rate_limited' }, 429);
  const { results: subs } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE account_id = ?').bind(auth.a).all();
  const statuses = await Promise.all(subs.map(s => sendPush(env, s, {
    title: '🔔 الإشعارات تعمل', body: 'ستصلك الإشعارات على هذا الجهاز حتى عندما يكون التطبيق مغلقاً.', url: './account.html#settings', tag: 'test',
  }, { ttl: 600 }).catch(() => 0)));
  return json({ ok: true, sent: statuses.filter(s => s >= 200 && s < 300).length, devices: subs.length });
}

// ---------------------------------------------------------------------------
// Sign-in, password change, forgotten password, devices
// ---------------------------------------------------------------------------

async function failures(env, key) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM rate_limit WHERE k = ? AND bucket >= ?')
    .bind(key, bucketOf(Date.now()) - 1).first();
  return row ? row.n : 0;
}

const deviceLabel = s => plainText(s, 80) || 'جهاز';

async function accountLogin(request, env, ip) {
  const body = await readJson(request);
  if (!body) return json({ success: false, error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  const deviceId = String(body.deviceId || '');
  if (!DEVICE_RE.test(deviceId)) return json({ success: false, error: 'bad_device' }, 400);
  if ((await failures(env, 'alogin:' + ip)) >= 40 || (await failures(env, 'alogin-u:' + username)) >= 10) {
    return json({ success: false, error: 'محاولات كثيرة خاطئة. يرجى الانتظار 10 دقائق ثم المحاولة مجدداً.' }, 429);
  }
  const row = USERNAME_RE.test(username) ? await env.DB.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first() : null;
  const hash = await sha256b64((row ? row.salt : 'x') + key);
  if (!row || hash !== row.pw || !KEY_RE.test(key)) {
    const bucket = bucketOf(Date.now());
    await env.DB.batch([
      env.DB.prepare('INSERT INTO rate_limit (k, bucket, n) VALUES (?, ?, 1) ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1').bind('alogin:' + ip, bucket),
      env.DB.prepare('INSERT INTO rate_limit (k, bucket, n) VALUES (?, ?, 1) ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1').bind('alogin-u:' + username, bucket),
    ]);
    return json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  if (row.status === 'pending') return json({ success: false, status: 'pending', error: 'حسابك بانتظار موافقة مشرف المستشفى.' });
  if (row.status !== 'active') return json({ success: false, status: row.status, error: 'هذا الحساب غير مفعّل. تواصل مع مشرف المستشفى.' });

  // Device limit: a new device is accepted only while the account is under its limit.
  const now = Date.now();
  const [known, count] = await env.DB.batch([
    env.DB.prepare('SELECT 1 AS k FROM account_devices WHERE account_id = ? AND device_id = ?').bind(row.id, deviceId),
    env.DB.prepare('SELECT COUNT(*) AS n FROM account_devices WHERE account_id = ?').bind(row.id),
  ]);
  if (!known.results.length && row.max_devices > 0 && count.results[0].n >= row.max_devices) {
    return json({
      success: false, status: 'device_limit',
      error: row.max_devices === 1
        ? 'هذا الحساب مقفل على جهاز واحد مسجّل. اطلب من مدير المستشفى إلغاء ربط الجهاز القديم.'
        : `هذا الحساب مسموح على ${row.max_devices} أجهزة فقط وقد اكتمل العدد. اطلب من مدير المستشفى إلغاء ربط أحد الأجهزة.`,
    }, 403);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO account_devices (account_id, device_id, label, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (account_id, device_id) DO UPDATE SET label = excluded.label, last_seen = excluded.last_seen`
    ).bind(row.id, deviceId, deviceLabel(body.deviceLabel), now),
    env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').bind(now, row.id),
  ]);
  const { token, exp } = await issueAccountToken(env, row, deviceId, body.remember);
  return json({ success: true, role: row.role, adminHospitals: scopeOf(row), token, exp, account: profile(row, await getStageMonth(env)) });
}

async function me(env, auth) {
  if (!auth.a) return json({ ok: true, account: null, role: auth.r, adminHospitals: auth.h });
  const row = await env.DB.prepare(
    `SELECT ${PUBLIC_FIELDS},
            (SELECT json_group_array(json_object('id', device_id, 'label', label, 'first', first_seen, 'last', last_seen))
               FROM account_devices d WHERE d.account_id = accounts.id) AS devices,
            (SELECT COUNT(*) FROM push_subs p WHERE p.account_id = accounts.id) AS push_devices
       FROM accounts WHERE id = ?`
  ).bind(auth.a).first();
  return json({ ok: true, account: profile(row, await getStageMonth(env)), role: auth.r, adminHospitals: auth.h, device: auth.dv, dutyDay: dutyDayNow() });
}

async function changePassword(request, env, auth) {
  if (!auth.a) return json({ error: 'no_account' }, 400);
  const body = await readJson(request);
  if (!body || !KEY_RE.test(String(body.newKey || ''))) return json({ error: 'bad_request' }, 400);
  if (await overLimit(env, 'pwchange:' + auth.a, 10)) return json({ error: 'rate_limited' }, 429);
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(auth.a).first();
  if (await sha256b64(row.salt + String(body.oldKey || '')) !== row.pw) return json({ error: 'wrong_password' }, 403);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const updated = await env.DB.prepare('UPDATE accounts SET pw = ?, salt = ?, sess = sess + 1 WHERE id = ? RETURNING *')
    .bind(await sha256b64(salt + body.newKey), salt, auth.a).first();
  // Other devices are signed out; this one gets a fresh token.
  const { token, exp } = await issueAccountToken(env, updated, auth.dv, true);
  return json({ ok: true, token, exp });
}

async function removeOwnDevice(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  const deviceId = String(body.deviceId || '');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM account_devices WHERE account_id = ? AND device_id = ?').bind(auth.a, deviceId),
    env.DB.prepare('DELETE FROM push_subs WHERE account_id = ? AND device_id = ?').bind(auth.a, deviceId),
  ]);
  return json({ ok: true, self: deviceId === auth.dv });
}

/** Always answers the same way, so it cannot be used to find out who has an account. */
async function forgot(request, env, ip, ctx) {
  if (await overLimit(env, 'forgot:' + ip, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const pk = phoneKey(body.phone);
  const row = USERNAME_RE.test(username) && pk
    ? await env.DB.prepare('SELECT id, name, hosp, phone, status, reset FROM accounts WHERE username = ?').bind(username).first()
    : null;
  if (row && row.phone === pk && row.status === 'active' && row.reset !== 'approved') {
    const now = Date.now();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET reset = 'requested', reset_at = ? WHERE id = ?").bind(now, row.id),
      notifyApprovers(env, row.hosp, 'reset:' + row.id, 'reset_request', JSON.stringify({ id: row.id, name: row.name, username, hosp: row.hosp }), now),
    ]);
    dispatchPush(env, ctx, results[1]);
  }
  return json({ ok: true });
}

/**
 * Without `key`: reports the state of the request ('none' | 'requested' | 'approved').
 * With `key`: sets the new password once an approver has allowed it.
 */
async function resetPassword(request, env, ip) {
  if (await overLimit(env, 'reset:' + ip, 30)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const pk = phoneKey(body.phone);
  const row = USERNAME_RE.test(username) && pk ? await env.DB.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first() : null;
  if (!row || row.phone !== pk || row.status !== 'active') return json({ ok: true, state: 'none' });
  const approved = row.reset === 'approved' && Date.now() - row.reset_at < RESET_VALID_MS;
  if (!body.key) return json({ ok: true, state: approved ? 'approved' : (row.reset === 'requested' ? 'requested' : 'none') });
  if (!approved) return json({ error: 'not_approved' }, 403);
  if (!KEY_RE.test(String(body.key))) return json({ error: 'bad_key' }, 400);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('UPDATE accounts SET pw = ?, salt = ?, sess = sess + 1, reset = NULL, reset_at = NULL WHERE id = ?')
    .bind(await sha256b64(salt + body.key), salt, row.id).run();
  return json({ ok: true, state: 'done' });
}

// ---------------------------------------------------------------------------
// Settings: anonymous nickname and its language
// ---------------------------------------------------------------------------

async function anonCheck(env, auth, url) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'anoncheck:' + auth.a, 120)) return json({ error: 'rate_limited' }, 429);
  const tag = String(url.searchParams.get('tag') || '').trim();
  const problem = nickProblem(tag);
  if (problem) return json({ ok: true, valid: false, free: false, reason: problem });
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE anon_key = ?').bind(nickKey(tag)).first();
  return json({ ok: true, valid: true, free: !row || row.id === auth.a, mine: !!row && row.id === auth.a });
}

/** Body: { mode: 'random' } | { mode: 'custom', tag } | { lang: 'ar' | 'en' } (a language change draws a new random nickname). */
async function setAnon(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  if (await overLimit(env, 'anonset:' + auth.a, 30)) return json({ error: 'rate_limited' }, 429);
  const row = await env.DB.prepare('SELECT sex, anon_lang FROM accounts WHERE id = ?').bind(auth.a).first();
  const lang = body.lang === 'en' || body.lang === 'ar' ? body.lang : row.anon_lang;
  if (body.mode === 'custom') {
    const tag = String(body.tag || '').trim();
    const problem = nickProblem(tag);
    if (problem) return json({ error: 'nick_' + problem }, 400);
    try {
      await env.DB.prepare('UPDATE accounts SET anon_tag = ?, anon_key = ? WHERE id = ?').bind(tag, nickKey(tag), auth.a).run();
    } catch (err) {
      if (/anon_key/.test(String(err && err.message))) return json({ error: 'nick_taken' }, 409);
      throw err;
    }
    return json({ ok: true, anon_tag: tag, anon_lang: row.anon_lang });
  }
  const tag = await withUniqueNick(row.sex, lang, async (t, k) => {
    await env.DB.prepare('UPDATE accounts SET anon_tag = ?, anon_key = ?, anon_lang = ? WHERE id = ?').bind(t, k, lang, auth.a).run();
    return t;
  });
  return json({ ok: true, anon_tag: tag, anon_lang: lang });
}

// ---------------------------------------------------------------------------
// Approvals and rights (owner: everyone; admins: plain users of their own hospitals)
// ---------------------------------------------------------------------------

const canApprove = auth => auth.r === 'owner' || auth.r === 'admin';
const seesAll = auth => auth.r === 'owner' || (auth.h || []).includes('*');
const hospInScope = (auth, hosp) => seesAll(auth) || (auth.h || []).includes(hosp);

async function listAccounts(env, auth, url) {
  if (!canApprove(auth)) return json({ error: 'forbidden' }, 403);
  const filter = url.searchParams.get('filter') || 'pending';
  const where = {
    pending: "status = 'pending'",
    resets: "reset = 'requested'",
    active: "status = 'active'",
    all: '1',
  }[filter] || "status = 'pending'";
  const fields = `${PUBLIC_FIELDS},
    (SELECT json_group_array(json_object('id', device_id, 'label', label, 'first', first_seen, 'last', last_seen))
       FROM account_devices d WHERE d.account_id = accounts.id) AS devices`;
  const stmt = seesAll(auth)
    ? env.DB.prepare(`SELECT ${fields} FROM accounts WHERE ${where} ORDER BY created_at DESC LIMIT 500`)
    : env.DB.prepare(`SELECT ${fields} FROM accounts WHERE ${where} AND hosp IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 500`).bind(JSON.stringify(auth.h || []));
  const { results } = await stmt.all();
  const month = await getStageMonth(env);
  return json({ ok: true, accounts: results.map(r => profile(r, month)), scope: seesAll(auth) ? ['*'] : auth.h, stageMonth: month });
}

/**
 * Body: { id, action, role?, hospitals?, maxDevices?, deviceId? }
 * action: approve | reject | disable | enable | approve_reset | deny_reset | set_role |
 *         set_devices | remove_device | reset_devices | delete
 * Admins act only on plain user accounts of their own hospitals; roles and deletion are the owner's.
 */
async function decide(request, env, auth, ctx) {
  if (!canApprove(auth)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(String(body.id || '')).first();
  if (!row) return json({ error: 'not_found' }, 404);
  const isOwner = auth.r === 'owner';
  if (!isOwner && (!hospInScope(auth, row.hosp) || row.role !== 'user' || row.id === auth.a)) return json({ error: 'forbidden' }, 403);

  const now = Date.now();
  const by = auth.a ? `${auth.r}:${auth.name || auth.a}` : auth.r;
  const action = String(body.action || '');
  const stmts = [];
  const notes = [];
  const setStatus = (status, bump) => env.DB.prepare(
    `UPDATE accounts SET status = ?, decided_at = ?, decided_by = ?${bump ? ', sess = sess + 1' : ''} WHERE id = ?`
  ).bind(status, now, by, row.id);

  let role = row.role, hospitals = scopeOf(row);
  if (body.role !== undefined || body.hospitals !== undefined) {
    if (!isOwner) return json({ error: 'forbidden' }, 403);
    role = ACCOUNT_ROLES.includes(body.role) ? body.role : row.role;
    hospitals = Array.isArray(body.hospitals) ? body.hospitals.map(String).filter(h => h === '*' || HOSP_RE.test(h)).slice(0, 50) : hospitals;
    if (role !== 'user' && role !== 'owner' && !hospitals.length) hospitals = [row.hosp];
    stmts.push(env.DB.prepare('UPDATE accounts SET role = ?, hospitals = ? WHERE id = ?').bind(role, JSON.stringify(role === 'user' || role === 'owner' ? [] : hospitals), row.id));
  }
  if (body.maxDevices !== undefined) {
    const n = Math.max(0, Math.min(20, Math.floor(Number(body.maxDevices) || 0)));
    stmts.push(env.DB.prepare('UPDATE accounts SET max_devices = ? WHERE id = ?').bind(n, row.id));
  }

  switch (action) {
    case 'approve':
      if (row.status !== 'pending') return json({ error: 'not_pending' }, 409);
      stmts.push(setStatus('active', false));
      notes.push(stmts.push(notifyOne(env, row.id, 'approved', 'account_approved', JSON.stringify({ by: auth.name || null, role }), now)) - 1);
      break;
    case 'reject':
      if (row.status !== 'pending') return json({ error: 'not_pending' }, 409);
      stmts.push(setStatus('rejected', true));
      break;
    case 'disable':
      stmts.push(setStatus('disabled', true));
      break;
    case 'enable':
      stmts.push(setStatus('active', false));
      break;
    case 'approve_reset':
      if (row.reset !== 'requested') return json({ error: 'no_request' }, 409);
      stmts.push(env.DB.prepare("UPDATE accounts SET reset = 'approved', reset_at = ? WHERE id = ?").bind(now, row.id));
      notes.push(stmts.push(notifyOne(env, row.id, 'reset', 'reset_approved', JSON.stringify({ by: auth.name || null }), now)) - 1);
      break;
    case 'deny_reset':
      stmts.push(env.DB.prepare('UPDATE accounts SET reset = NULL, reset_at = NULL WHERE id = ?').bind(row.id));
      break;
    case 'set_role':
      if (!isOwner) return json({ error: 'forbidden' }, 403);
      if (role !== row.role || JSON.stringify(hospitals) !== JSON.stringify(scopeOf(row))) {
        notes.push(stmts.push(notifyOne(env, row.id, 'role', 'role_changed', JSON.stringify({ role, hospitals }), now)) - 1);
      }
      break;
    case 'set_devices':
      if (body.maxDevices === undefined) return json({ error: 'bad_request' }, 400);
      break;
    case 'set_profile': {
      if (!isOwner) return json({ error: 'forbidden' }, 403);
      const p = cleanProfile(body.profile || {});
      if (p.error) return json({ error: p.error }, 400);
      const sex = body.profile && (body.profile.sex === 'm' || body.profile.sex === 'f') ? body.profile.sex : row.sex;
      const hosp = body.profile && HOSP_RE.test(String(body.profile.hosp || '')) ? String(body.profile.hosp) : row.hosp;
      stmts.push(env.DB.prepare(
        `UPDATE accounts SET board = ?, specialty = ?, stage = ?, stage_ref = ?, board_years = ?, profile_src = 'owner', sex = ?, hosp = ? WHERE id = ?`
      ).bind(p.board, p.specialty, p.stage, p.stage === null ? null : now, p.boardYears, sex, hosp, row.id));
      break;
    }
    case 'remove_device':
      stmts.push(
        env.DB.prepare('DELETE FROM account_devices WHERE account_id = ? AND device_id = ?').bind(row.id, String(body.deviceId || '')),
        env.DB.prepare('DELETE FROM push_subs WHERE account_id = ? AND device_id = ?').bind(row.id, String(body.deviceId || '')),
      );
      break;
    case 'reset_devices':
      stmts.push(
        env.DB.prepare('DELETE FROM account_devices WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM push_subs WHERE account_id = ?').bind(row.id),
      );
      break;
    case 'delete':
      if (!isOwner) return json({ error: 'forbidden' }, 403);
      stmts.push(
        env.DB.prepare('DELETE FROM likes WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM notifications WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM account_devices WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM push_subs WHERE account_id = ?').bind(row.id),
        env.DB.prepare("UPDATE comments SET deleted = 1, deleted_by = 'account deleted' WHERE account_id = ?").bind(row.id),
        env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(row.id),
      );
      break;
    default:
      return json({ error: 'bad_action' }, 400);
  }
  // The request is handled: clear the matching notification for every approver.
  if (['approve', 'reject', 'delete'].includes(action)) stmts.push(env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('signup:' + row.id));
  if (['approve_reset', 'deny_reset', 'delete'].includes(action)) stmts.push(env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('reset:' + row.id));
  stmts.push(env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(now, by,
    `Account ${action}: ${row.username}${role !== row.role ? ' -> ' + role : ''}${body.maxDevices !== undefined ? ' devices=' + body.maxDevices : ''}`));
  const results = await env.DB.batch(stmts);
  dispatchPush(env, ctx, ...notes.map(i => results[i]));
  const updated = await env.DB.prepare(
    `SELECT ${PUBLIC_FIELDS},
            (SELECT json_group_array(json_object('id', device_id, 'label', label, 'first', first_seen, 'last', last_seen))
               FROM account_devices d WHERE d.account_id = accounts.id) AS devices
       FROM accounts WHERE id = ?`
  ).bind(row.id).first();
  return json({ ok: true, account: profile(updated, await getStageMonth(env)) });
}

// ---------------------------------------------------------------------------
// Resident profile (board, specialty, stage) and the comments a resident received
// ---------------------------------------------------------------------------

/** Validates { board, specialty, stage, boardYears }. Stage is the stage today (it moves up yearly). */
function cleanProfile(p) {
  const board = BOARDS.includes(p.board) ? p.board : null;
  const specialty = plainText(p.specialty, 80) || null;
  let stage = p.stage === '' || p.stage === null || p.stage === undefined ? null : Math.floor(Number(p.stage));
  let boardYears = p.boardYears === '' || p.boardYears === null || p.boardYears === undefined ? null : Math.floor(Number(p.boardYears));
  if (board === 'none') { stage = null; boardYears = null; }
  if (stage !== null && !(stage >= 1 && stage <= 10)) return { error: 'bad_stage' };
  if (boardYears !== null && !(boardYears >= 1 && boardYears <= 10)) return { error: 'bad_years' };
  if (stage !== null && boardYears !== null && stage > boardYears) return { error: 'stage_over_years' };
  return { board, specialty, stage, boardYears };
}

async function profileSuggest(env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const row = await env.DB.prepare('SELECT name, hosp, resident_id, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  const s = await suggestProfile(env, { name: row.name, hosp: row.hosp, residentId: row.resident_id, phone: row.phone });
  return json({ ok: true, suggestion: s });
}

async function saveProfile(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'profile:' + auth.a, 30)) return json({ error: 'rate_limited' }, 429);
  const p = cleanProfile(await readJson(request) || {});
  if (p.error) return json({ error: p.error }, 400);
  const row = await env.DB.prepare(
    `UPDATE accounts SET board = ?, specialty = ?, stage = ?, stage_ref = ?, board_years = ?, profile_src = 'user' WHERE id = ?
     RETURNING ${PUBLIC_FIELDS}`
  ).bind(p.board, p.specialty, p.stage, p.stage === null ? null : Date.now(), p.boardYears, auth.a).first();
  return json({ ok: true, account: profile(row, await getStageMonth(env)) });
}

async function putStageMonth(request, env, auth) {
  if (auth.r !== 'owner') return json({ error: 'forbidden' }, 403);
  const body = await readJson(request) || {};
  const month = Math.floor(Number(body.month));
  if (!(month >= 1 && month <= 12)) return json({ error: 'bad_month' }, 400);
  // Keep everyone's current stage: re-base stages counted under the old month to today.
  const old = await getStageMonth(env);
  if (old !== month) {
    const { results } = await env.DB.prepare('SELECT id, stage, stage_ref, board_years FROM accounts WHERE stage IS NOT NULL').all();
    const now = Date.now();
    const stmts = results.map(r => env.DB.prepare('UPDATE accounts SET stage = ?, stage_ref = ? WHERE id = ?')
      .bind(currentStage(r.stage, r.stage_ref, r.board_years, old, now), now, r.id));
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    await setStageMonth(env, month);
    await env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)').bind(now, auth.a ? `owner:${auth.name}` : 'owner', `Stage level-up month: ${old} -> ${month}`, results.length).run();
  }
  return json({ ok: true, month });
}

/** Every comment ever written on this resident's duty cards (newest first, 50 per page). */
async function receivedComments(env, auth, url) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const before = Number(url.searchParams.get('before')) || 1e15;
  const me = await env.DB.prepare('SELECT name_key FROM accounts WHERE id = ?').bind(auth.a).first();
  const [list, totals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.cid, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex
         FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.card_key = ?1 AND c.deleted = 0 AND c.cid < ?2 ORDER BY c.cid DESC LIMIT 50`
    ).bind(me.name_key, before),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM comments WHERE card_key = ?1 AND deleted = 0) AS comments,
              (SELECT COUNT(*) FROM likes WHERE card_key = ?1) AS likes,
              (SELECT COUNT(DISTINCT card_date) FROM comments WHERE card_key = ?1 AND deleted = 0) AS days`
    ).bind(me.name_key),
  ]);
  return json({
    ok: true,
    comments: list.results.map(c => ({ ...commentView({ ...c, card_date: c.card_date }, { ...auth, r: 'user' }), hosp: c.hosp, date: c.card_date })),
    totals: totals.results[0],
  });
}

// ---------------------------------------------------------------------------
// Notifications list
// ---------------------------------------------------------------------------

async function listNotifications(env, auth, url) {
  const stmts = [];
  const since = Number(url.searchParams.get('since')) || 0;
  const now = Date.now();
  if (auth.a) {
    stmts.push(env.DB.prepare(
      'SELECT nid, type, data, ts, seen FROM notifications WHERE account_id = ?1 AND ts > ?2 ORDER BY ts DESC LIMIT 40'
    ).bind(auth.a, since));
    stmts.push(env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND seen = 0').bind(auth.a));
  }
  if (canApprove(auth)) {
    const scope = seesAll(auth) ? '' : ' AND hosp IN (SELECT value FROM json_each(?1))';
    stmts.push(env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM accounts WHERE status = 'pending'${scope}) AS accounts,
              (SELECT COUNT(*) FROM accounts WHERE reset = 'requested'${scope}) AS resets`
    ).bind(...(seesAll(auth) ? [] : [JSON.stringify(auth.h || [])])));
  }
  if (auth.a) {
    // Writes only when the stored value is over an hour old (keeps D1 writes low).
    stmts.push(env.DB.prepare('UPDATE accounts SET last_seen = ?1 WHERE id = ?2 AND COALESCE(last_seen, 0) < ?3').bind(now, auth.a, now - ACTIVE_WRITE_MS));
    stmts.push(env.DB.prepare('UPDATE account_devices SET last_seen = ?1 WHERE account_id = ?2 AND device_id = ?3 AND last_seen < ?4').bind(now, auth.a, auth.dv || '', now - ACTIVE_WRITE_MS));
  }
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  let i = 0;
  const items = auth.a ? res[i++].results.map(n => ({ ...n, data: JSON.parse(n.data) })) : [];
  const unread = auth.a ? res[i++].results[0].n : 0;
  const pending = canApprove(auth) ? res[i++].results[0] : null;
  return json({ ok: true, items, unread, pending, time: now });
}

async function markSeen(request, env, auth) {
  if (!auth.a) return json({ ok: true });
  const body = await readJson(request) || {};
  if (Array.isArray(body.nids) && body.nids.length) {
    await env.DB.prepare('UPDATE notifications SET seen = 1 WHERE account_id = ?1 AND seen = 0 AND nid IN (SELECT value FROM json_each(?2))')
      .bind(auth.a, JSON.stringify(body.nids.map(Number).slice(0, 200))).run();
  } else {
    await env.DB.prepare('UPDATE notifications SET seen = 1 WHERE account_id = ? AND seen = 0').bind(auth.a).run();
  }
  // Keep the table small: drop old, already-read notifications of this account.
  await env.DB.prepare('DELETE FROM notifications WHERE account_id = ? AND seen = 1 AND ts < ?').bind(auth.a, Date.now() - 60 * DAY).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Likes and comments on duty cards
// ---------------------------------------------------------------------------

/** A duty card is one resident on one day at one hospital. */
function cardTarget(h, d, n) {
  const hosp = String(h || '');
  const date = isoDate(d);
  const key = nameKey(n);
  if (!HOSP_RE.test(hosp) || !date || !key || String(n).length > 120) return null;
  return { target: `duty:${hosp}:${date}:${key}`, hosp, date, key, name: String(n).slice(0, 120) };
}

/** Counts for every card on the roster in one query. ?h=<hospital>&d=<date>&n=<name>&n=<name>... */
async function socialSummary(env, auth, url) {
  const names = url.searchParams.getAll('n').slice(0, 60);
  const cards = names.map(n => cardTarget(url.searchParams.get('h'), url.searchParams.get('d'), n));
  const valid = cards.filter(Boolean);
  if (!valid.length) return json({ ok: true, cards: {} });
  const { results } = await env.DB.prepare(
    `SELECT t.value AS target,
            (SELECT COUNT(*) FROM likes l WHERE l.target = t.value) AS likes,
            (SELECT COUNT(*) FROM comments c WHERE c.target = t.value AND c.deleted = 0) AS comments,
            EXISTS (SELECT 1 FROM likes l WHERE l.target = t.value AND l.account_id = ?2) AS mine
       FROM json_each(?1) t`
  ).bind(JSON.stringify([...new Set(valid.map(c => c.target))]), (auth && auth.a) || '').all();
  const byTarget = new Map(results.map(r => [r.target, r]));
  const out = {};
  names.forEach((n, i) => {
    const r = cards[i] && byTarget.get(cards[i].target);
    if (r) out[n] = { likes: r.likes, comments: r.comments, mine: !!r.mine };
  });
  return json({ ok: true, cards: out, canReact: !!(auth && auth.a) });
}

const canModerate = (auth, hosp) => auth.r === 'owner' || (auth.r === 'admin' && hospInScope(auth, hosp));

/** Authors may edit / delete only while the card's duty day is running. */
const dutyOpen = cardDate => !!cardDate && cardDate === dutyDayNow();

function commentView(c, auth) {
  const mine = !!auth.a && c.account_id === auth.a;
  const open = dutyOpen(c.card_date);
  return {
    cid: c.cid,
    // Anonymous comments show the author's current nickname to everyone.
    author: c.anon ? (c.anon_tag || 'مجهول') : (c.name || '—'),
    anon: !!c.anon,
    sex: c.sex || null,
    // Only the owner can see who is behind a nickname (to deal with abuse).
    realName: auth.r === 'owner' && c.anon ? c.name : undefined,
    body: c.body,
    ts: c.ts,
    mine,
    edited: !!c.edited_at,
    canEdit: mine && open,
    canDelete: (mine && open) || canModerate(auth, c.hosp),
  };
}

async function thread(env, auth, url) {
  const card = cardTarget(url.searchParams.get('h'), url.searchParams.get('d'), url.searchParams.get('n'));
  if (!card) return json({ error: 'bad_request' }, 400);
  const [likesRes, commentsRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.name AS name, l.ts AS ts, l.account_id = ?2 AS mine FROM likes l JOIN accounts a ON a.id = l.account_id
        WHERE l.target = ?1 ORDER BY l.ts DESC LIMIT 300`
    ).bind(card.target, auth.a || ''),
    env.DB.prepare(
      `SELECT c.cid, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex
         FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.target = ?1 AND c.deleted = 0 ORDER BY c.cid LIMIT 300`
    ).bind(card.target),
  ]);
  return json({
    ok: true,
    likes: likesRes.results.map(l => ({ name: l.name, ts: l.ts, mine: !!l.mine })),
    comments: commentsRes.results.map(c => commentView(c, auth)),
    canReact: !!auth.a,
    open: dutyOpen(card.date),
    dutyDay: dutyDayNow(),
    myAnonTag: auth.anon || null,
  });
}

/** Moderation feed: owner sees every hospital, an admin only their own. ?hosp=<id>&before=<cid> */
async function recentComments(env, auth, url) {
  if (!canApprove(auth)) return json({ error: 'forbidden' }, 403);
  const hosp = url.searchParams.get('hosp') || '';
  const before = Number(url.searchParams.get('before')) || 1e15;
  const hospitals = seesAll(auth) ? (hosp ? [hosp] : null) : (auth.h || []).filter(h => !hosp || h === hosp);
  const { results } = await env.DB.prepare(
    `SELECT c.cid, c.target, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex
       FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.deleted = 0 AND c.cid < ?1 ${hospitals ? 'AND c.hosp IN (SELECT value FROM json_each(?2))' : ''}
      ORDER BY c.cid DESC LIMIT 50`
  ).bind(before, ...(hospitals ? [JSON.stringify(hospitals)] : [])).all();
  return json({
    ok: true,
    comments: results.map(c => {
      const [, , date, ...rest] = c.target.split(':');
      return { ...commentView(c, auth), hosp: c.hosp, date, cardKey: rest.join(':') };
    }),
  });
}

/** Resident accounts that own a duty card (anyone whose roster name matches), minus the actor. */
function notifyCardOwners(env, card, actorId, type, extra, now) {
  const gkey = `${type}:${card.target}`;
  const countSql = type === 'like'
    ? '(SELECT COUNT(*) FROM likes WHERE target = ?1)'
    : '(SELECT COUNT(*) FROM comments WHERE target = ?1 AND deleted = 0)';
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT a.id, ?2, ?3, json_object('h', ?4, 'd', ?5, 'name', ?6, 'count', ${countSql}, 'last', ?7, 'text', ?8), ?9, 0
       FROM accounts a WHERE a.name_key = ?10 AND a.status = 'active' AND a.id <> ?11
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(card.target, gkey, type, card.hosp, card.date, card.name, extra.last, extra.text || null, now, card.key, actorId);
}

async function like(request, env, auth, ctx) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request);
  const card = body && cardTarget(body.h, body.d, body.n);
  if (!card) return json({ error: 'bad_request' }, 400);
  if (!dutyOpen(card.date)) return json({ error: 'duty_closed' }, 409);
  if (await overLimit(env, 'like:' + auth.a, 120)) return json({ error: 'rate_limited' }, 429);
  const now = Date.now();
  if (body.on === false) {
    await env.DB.prepare('DELETE FROM likes WHERE target = ? AND account_id = ?').bind(card.target, auth.a).run();
  } else {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO likes (target, account_id, ts, card_key) VALUES (?, ?, ?, ?)').bind(card.target, auth.a, now, card.key).run();
    if (ins.meta.changes) dispatchPush(env, ctx, await notifyCardOwners(env, card, auth.a, 'like', { last: auth.name }, now).all());
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS n, EXISTS (SELECT 1 FROM likes WHERE target = ?1 AND account_id = ?2) AS mine FROM likes WHERE target = ?1')
    .bind(card.target, auth.a).first();
  return json({ ok: true, likes: row.n, mine: !!row.mine });
}

async function addComment(request, env, auth, ctx) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request);
  const card = body && cardTarget(body.h, body.d, body.n);
  const text = plainText(body && body.body, 600);
  if (!card || !text) return json({ error: 'bad_request' }, 400);
  if (!dutyOpen(card.date)) return json({ error: 'duty_closed' }, 409);
  if (await overLimit(env, 'comment:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);
  const now = Date.now();
  const anon = !!body.anon;
  const [ins, notes] = await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (target, hosp, account_id, anon, body, ts, card_key, card_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING cid')
      .bind(card.target, card.hosp, auth.a, anon ? 1 : 0, text, now, card.key, card.date),
    notifyCardOwners(env, card, auth.a, 'comment', { last: anon ? auth.anon : auth.name, text: text.slice(0, 120) }, now),
  ]);
  dispatchPush(env, ctx, notes);
  return json({
    ok: true,
    comment: { cid: ins.results[0].cid, author: anon ? auth.anon : auth.name, anon, body: text, ts: now, mine: true, canEdit: true, canDelete: true, edited: false },
  });
}

async function deleteComment(request, env, auth) {
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT cid, hosp, account_id, card_date FROM comments WHERE cid = ? AND deleted = 0').bind(Number(body && body.cid) || 0).first();
  if (!row) return json({ error: 'not_found' }, 404);
  const own = !!auth.a && row.account_id === auth.a && dutyOpen(row.card_date);
  if (!own && !canModerate(auth, row.hosp)) {
    return json({ error: row.account_id === auth.a ? 'duty_closed' : 'forbidden' }, row.account_id === auth.a ? 409 : 403);
  }
  const by = own ? 'author' : (auth.a ? `${auth.r}:${auth.name}` : auth.r);
  await env.DB.batch([
    env.DB.prepare('UPDATE comments SET deleted = 1, deleted_by = ? WHERE cid = ?').bind(by, row.cid),
    ...(own ? [] : [env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), by, `Comment ${row.cid} removed (${row.hosp})`)]),
  ]);
  return json({ ok: true });
}

/** Authors edit their own comment while the duty day is running. */
async function editComment(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request) || {};
  const text = plainText(body.body, 600);
  if (!text) return json({ error: 'bad_request' }, 400);
  const row = await env.DB.prepare('SELECT cid, account_id, card_date FROM comments WHERE cid = ? AND deleted = 0').bind(Number(body.cid) || 0).first();
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.account_id !== auth.a) return json({ error: 'forbidden' }, 403);
  if (!dutyOpen(row.card_date)) return json({ error: 'duty_closed' }, 409);
  const now = Date.now();
  await env.DB.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE cid = ?').bind(text, now, row.cid).run();
  return json({ ok: true, body: text, edited_at: now });
}
