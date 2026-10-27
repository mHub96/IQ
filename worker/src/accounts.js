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
import { nameKey, nameTokens, namesMatch, phoneKey, isoDate } from './names.js';
import { sendPush, isPushEndpoint, topicFor } from './push.js';
import { isRotatorSpec } from './exchspecs.js';
import { cardStatuses } from './oncall.js';
import { durationText } from './reminders.js';
import { BOARDS, dutyDayNow, getStageMonth, setStageMonth, currentStage, profileComplete, suggestProfile } from './profile.js';
import { AA_ROLES, findOfficer, officerLink, divisionJob, addOfficer } from './aa.js';
import { canUseEr } from './eraccess.js';
import { ensureRotatorRecord, rotatorCheckHospitals, setRotatorCheck } from './rotators.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,23}$/;
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes, base64
const HOSP_RE = /^[\w-]{1,48}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ACCOUNT_ROLES = ['user', 'anaesthesia', 'admin', 'owner', 'rotator', ...AA_ROLES];
// Roles a hospital admin may give when approving or managing a resident of their hospital (never
// owner), and an officer of the hospital's Administrative Affairs division (division user or admin).
// A resident can also be made a rotator (and back again, see decide).
const ADMIN_GIVES = ['user', 'anaesthesia', 'admin', 'rotator'];
// Resident roles: the only accounts that can become rotators.
const RESIDENT_ROLES = ['user', 'anaesthesia', 'admin'];
const ADMIN_GIVES_AA = AA_ROLES;
// Accounts a hospital admin manages (never other admins or the owner).
const ADMIN_MANAGES = ['user', 'anaesthesia', 'rotator', ...AA_ROLES];
// Roles without hospital scope (rights come from the role alone, or from the account's own hospital).
const UNSCOPED = ['user', 'owner', 'rotator', ...AA_ROLES];
// Accounts without a resident profile (board, specialty, stage): rotators and division officers.
const NO_PROFILE = ['rotator', ...AA_ROLES];
// Roster specialty codes of anaesthesia residents (suggested role "anaesthesia" on their sign-up request).
const ANAESTHESIA_CODES = ['A', 'ICU', 'OP', 'GA'];
const ROTATOR_NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]{3,59}$/u;
const RESET_VALID_MS = 3 * DAY;
const ACTIVE_WRITE_MS = 60 * 60 * 1000; // last_seen is refreshed at most hourly (D1 write budget)
const PUBLIC_FIELDS = `id, username, name, phone, sex, hosp, resident_id, role, hospitals, status, max_devices,
  anon_tag, anon_lang, reset, reset_at, created_at, decided_at, decided_by, last_seen,
  board, specialty, stage, stage_ref, board_years, profile_src, avatar, aa_job, aa_job_name, no_comment, warnings`;

/** Routes under /api/accounts, /api/notifications, /api/social and /api/push. Returns null when not matched. */
export async function routeAccounts(path, method, request, env, auth, url, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  switch (`${method} ${path}`) {
    case 'POST /api/accounts/check': return checkIdentity(request, env, ip);
    case 'GET /api/accounts/username': return usernameFree(env, url, ip);
    case 'POST /api/accounts/signup': return signup(request, env, ip, ctx);
    case 'POST /api/accounts/signup-rotator': return signupRotator(request, env, ip, ctx);
    case 'POST /api/accounts/check-rotator': return checkRotator(request, env, ip);
    case 'POST /api/accounts/signup-officer': return signupOfficer(request, env, ip, ctx);
    case 'POST /api/accounts/login': return accountLogin(request, env, ip);
    case 'POST /api/accounts/forgot': return forgot(request, env, ip, ctx);
    case 'POST /api/accounts/reset': return resetPassword(request, env, ip);
    case 'GET /api/social': return auth ? socialSummary(env, auth, url) : json({ error: 'unauthorized' }, 401);
    case 'GET /api/push/key': return json({ ok: true, key: env.VAPID_PUBLIC || null });
  }
  if (!/^\/api\/(accounts|notifications|social|push)(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/accounts/me': return me(env, auth);
    case 'POST /api/accounts/password': return changePassword(request, env, auth);
    case 'POST /api/accounts/rename': return renameAccount(request, env, auth);
    case 'GET /api/accounts/anon-check': return anonCheck(env, auth, url);
    case 'GET /api/accounts/profile-suggest': return profileSuggest(env, auth);
    case 'POST /api/accounts/profile': return saveProfile(request, env, auth);
    case 'POST /api/accounts/avatar': return saveAvatar(request, env, auth);
    case 'GET /api/accounts/received': return receivedComments(env, auth, url);
    case 'GET /api/accounts/stage-month': return json({ ok: true, month: await getStageMonth(env) });
    case 'GET /api/accounts/er-profiles': return erProfiles(env, auth, url);
    case 'GET /api/accounts/census': return census(env, auth, url);
    case 'POST /api/accounts/specialty-rename': return renameSpecialty(request, env, auth);
    case 'POST /api/accounts/stage-month': return putStageMonth(request, env, auth);
    case 'POST /api/accounts/anon': return setAnon(request, env, auth);
    case 'POST /api/accounts/devices/remove': return removeOwnDevice(request, env, auth);
    case 'GET /api/accounts': return listAccounts(env, auth, url);
    case 'POST /api/accounts/decide': return decide(request, env, auth, ctx);
    case 'GET /api/accounts/rotator-check': return json({ ok: true, on: await rotatorCheckHospitals(env) });
    case 'POST /api/accounts/rotator-check': return setRotatorCheck(request, env, auth);
    case 'GET /api/notifications': return listNotifications(env, auth, url);
    case 'POST /api/notifications/seen': return markSeen(request, env, auth);
    case 'POST /api/notifications/clear': return clearNotifications(request, env, auth);
    case 'GET /api/social/thread': return thread(env, auth, url);
    case 'GET /api/social/recent': return recentComments(env, auth, url);
    case 'POST /api/social/like': return like(request, env, auth, ctx);
    case 'POST /api/social/comment': return addComment(request, env, auth, ctx);
    case 'POST /api/social/comment/delete': return deleteComment(request, env, auth);
    case 'POST /api/social/comment/edit': return editComment(request, env, auth);
    case 'POST /api/social/comment/warn': return warnComment(request, env, auth, ctx);
    case 'GET /api/social/hospitals': return commentSwitches(env, auth);
    case 'POST /api/social/hospitals': return setCommentSwitch(request, env, auth);
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
  if (UNSCOPED.includes(row.role)) return [];
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
    `SELECT a.id, a.role, a.hospitals, a.status, a.sess, a.name, a.hosp, a.anon_tag, a.sex, a.avatar, d.device_id AS dev
       FROM accounts a LEFT JOIN account_devices d ON d.account_id = a.id AND d.device_id = ?2
      WHERE a.id = ?1`
  ).bind(payload.a, payload.dv || '').first();
  if (!row || row.status !== 'active' || row.sess !== payload.s || !row.dev) return null;
  return { r: row.role, h: scopeOf(row), e: payload.e, a: row.id, name: row.name, hosp: row.hosp, anon: row.anon_tag, sex: row.sex, avatar: row.avatar, dv: payload.dv };
}

function profile(row, stageMonth = 10) {
  if (!row) return null;
  const { pw, salt, anon_key, devices, ...rest } = row;
  const out = { ...rest, hospitals: scopeOf(row) };
  if ('avatar' in row) out.avatar = parseAvatar(row.avatar);
  if ('roster_spec' in row) {
    delete out.roster_spec;
    // Pending requests: suggest the anaesthesia role for anaesthesia residents.
    if (row.role === 'user' && (ANAESTHESIA_CODES.includes(row.roster_spec) || /تخدير|anaes|anest/i.test(row.specialty || ''))) out.suggested_role = 'anaesthesia';
  }
  if (NO_PROFILE.includes(row.role)) {
    for (const k of ['board', 'specialty', 'stage', 'stage_ref', 'board_years', 'profile_src']) delete out[k];
  } else if ('board' in row) {
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
  const hospitalsOf = r => { try { return JSON.parse(r.hospitals || '[]') || []; } catch { return []; } };
  const inHospital = r => hospitalsOf(r).includes(hosp);
  // The phone number identifies the resident; the first name confirms it (names are often written
  // shorter than in the database, e.g. "ابو تراب" for "د. ابو تراب قيس عبدالحسن").
  const typed = nameTokens(name);
  const firstOk = c => !!typed[0] && typed[0].length >= 2 && nameTokens(c.name)[0] === typed[0];
  const samePhone = [...residents.results.filter(inHospital), ...names.results].filter(c => phoneKey(c.phone) === pk);
  const match = samePhone.find(firstOk) || null;
  if (match) return { hospOk: true, match, pk };
  // Not found: say why, so nobody is told "no such resident" when the database has them.
  if (samePhone.length) return { hospOk: true, match: null, pk, reason: 'phone_other_name' };
  const elsewhere = residents.results.filter(r => phoneKey(r.phone) === pk && !inHospital(r) && firstOk(r));
  if (elsewhere.length) return { hospOk: true, match: null, pk, reason: 'other_hospital', hospitals: [...new Set(elsewhere.flatMap(hospitalsOf))] };
  if (typed.length >= 2) {
    const { results: same } = await env.DB.prepare(
      `SELECT json_extract(data, '$.name') AS name FROM records
        WHERE coll = 'resident' AND EXISTS (SELECT 1 FROM json_each(records.data, '$.hospitals') h WHERE h.value = ?1)`
    ).bind(hosp).all();
    if ((same || []).some(r => namesMatch(name, r.name))) return { hospOk: true, match: null, pk, reason: 'name_other_phone' };
  }
  return { hospOk: true, match: null, pk, reason: 'none' };
}

/** Is this hospital-database record filed under the rotators' specialty? */
async function isRotatorRecord(env, hosp, residentId) {
  if (!residentId) return false;
  const [res, meta, hospital] = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(json_extract(data, '$.spec'), json_extract(data, '$.tag')) AS spec FROM records WHERE coll = 'resident' AND id = ?").bind(residentId),
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
  ]);
  const code = res.results[0] && res.results[0].spec;
  if (!code) return false;
  // The store first (a hospital's copy of a store specialty can lag behind), then the hospital's own.
  let specs = [];
  try { specs = specs.concat((JSON.parse(meta.results[0] && meta.results[0].data || '{}').value) || []); } catch {}
  try { specs = specs.concat(JSON.parse(hospital.results[0] && hospital.results[0].specs || '[]') || []); } catch {}
  return isRotatorSpec(specs, code);
}

async function checkIdentity(request, env, ip) {
  if (await overLimit(env, 'check:' + ip, 60)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const found = await findResident(env, String(body.hosp || ''), String(body.name || ''), String(body.phone || ''));
  const { hospOk, match } = found;
  if (!hospOk || !match) return json({ ok: true, match: false, reason: found.reason || 'none', hospitals: found.hospitals || [] });
  const taken = await env.DB.prepare("SELECT 1 AS t FROM accounts WHERE resident_id = ? AND status IN ('pending', 'active')").bind(match.id || '').first();
  const hint = taken ? {} : await suggestProfile(env, { name: match.name, hosp: String(body.hosp), residentId: match.id, phone: body.phone }).catch(() => ({}));
  // Filed under the rotators' specialty: the page offers the rotator sign-up instead.
  const rotator = await isRotatorRecord(env, String(body.hosp), match.id).catch(() => false);
  return json({ ok: true, match: true, taken: !!taken, name: match.name, sex: hint.sex || null, rotator });
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
  // Rotators sign up as rotators (signup-rotator).
  if (await isRotatorRecord(env, hosp, match.id)) return json({ error: 'is_rotator', name: match.name }, 409);

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

/** The rotators' database entry for this name and number, and whether an account already holds it. */
async function findRotator(env, hosp, name, phone) {
  const found = await findResident(env, hosp, name, phone);
  if (!found.match || !(await isRotatorRecord(env, hosp, found.match.id))) return { linked: null, taken: false };
  const taken = await env.DB.prepare("SELECT 1 AS t FROM accounts WHERE resident_id = ? AND status IN ('pending', 'active')").bind(found.match.id).first();
  return { linked: taken ? null : found.match, taken: !!taken };
}

/** For the rotator sign-up form: is the number check on here, and is this rotator in the database? */
async function checkRotator(request, env, ip) {
  if (await overLimit(env, 'check:' + ip, 60)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const hosp = String(body.hosp || '');
  const check = (await rotatorCheckHospitals(env)).includes(hosp);
  if (!phoneKey(body.phone) || !String(body.name || '').trim()) return json({ ok: true, check, match: false });
  const { linked, taken } = await findRotator(env, hosp, String(body.name), String(body.phone));
  return json({ ok: true, check, match: !!linked || taken, taken, name: linked ? linked.name : null });
}

/**
 * Rotators: doctors on rotation, not in the roster. Name, username, password, sex and the hospital
 * they rotate in (whose admins approve them). They can view the site and comment, nothing more.
 */
async function signupRotator(request, env, ip, ctx) {
  if (await overLimit(env, 'signup:' + ip, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  const hosp = String(body.hosp || '');
  const name = plainText(body.name, 60).replace(/\s+/g, ' ');
  const sex = body.sex === 'f' ? 'f' : body.sex === 'm' ? 'm' : null;
  const lang = body.lang === 'en' ? 'en' : 'ar';
  if (!sex) return json({ error: 'bad_sex' }, 400);
  if (!ROTATOR_NAME_RE.test(name) || name.split(' ').filter(Boolean).length < 2) return json({ error: 'bad_name' }, 400);
  if (!USERNAME_RE.test(username)) return json({ error: 'bad_username' }, 400);
  if (!KEY_RE.test(key)) return json({ error: 'bad_key' }, 400);
  if (!HOSP_RE.test(hosp) || !(await env.DB.prepare("SELECT 1 AS ok FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp).first())) return json({ error: 'bad_hospital' }, 400);

  if (!phoneKey(body.phone)) return json({ error: 'bad_phone' }, 400);

  // A rotator found in the hospital's database (name and phone, filed under the rotators' specialty) is
  // linked to that record: the account carries its name, and the record cannot get a second account.
  // With the hospital's number check on, only those can sign up; otherwise the others are added to the
  // database when their account is approved (rotators.js).
  const { linked, taken } = await findRotator(env, hosp, name, String(body.phone));
  if (taken) return json({ error: 'already_registered' }, 409);
  if (!linked && (await rotatorCheckHospitals(env)).includes(hosp)) return json({ error: 'no_match' }, 400);
  const phone = phoneKey(body.phone);
  const accName = linked ? linked.name : name;

  const now = Date.now();
  const id = crypto.randomUUID();
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const pw = await sha256b64(salt + key);
  const note = JSON.stringify({ id, name: accName, username, hosp, rotator: true });
  try {
    const results = await withUniqueNick(sex, lang, (tag, tagKey) => env.DB.batch([
      // name_key is private to the account so a rotator never receives a resident's duty-card notifications.
      env.DB.prepare(
        `INSERT INTO accounts (id, username, pw, salt, name, name_key, phone, sex, hosp, resident_id, role, anon_tag, anon_key, anon_lang, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rotator', ?, ?, ?, ?)`
      ).bind(id, username, pw, salt, accName, 'rotator:' + id, phone, sex, hosp, linked ? linked.id || null : null, tag, tagKey, lang, now),
      notifyApprovers(env, hosp, 'signup:' + id, 'signup_request', note, now),
    ]));
    dispatchPush(env, ctx, results[1]);
  } catch (err) {
    if (/accounts\.username/.test(String(err && err.message || err))) return json({ error: 'username_taken' }, 409);
    if (/resident_id|idx_accounts_resident/.test(String(err && err.message || err))) return json({ error: 'already_registered' }, 409);
    throw err;
  }
  return json({ ok: true, status: 'pending', name: accName, linked: !!linked });
}

/**
 * Officers of a hospital's Administrative Affairs division: hospital, job title (from the
 * division's list), name, phone, sex, username and password. The name and phone are checked
 * against the division's officers like residents are against the roster; someone who is not in
 * the database yet may still send the request (the approver then adds them under the chosen job
 * title). Approved by the owner and the hospital's admins as a division user or division admin.
 */
async function signupOfficer(request, env, ip, ctx) {
  if (await overLimit(env, 'signup:' + ip, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  const hosp = String(body.hosp || '');
  const typed = plainText(body.name, 60).replace(/\s+/g, ' ');
  const sex = body.sex === 'f' ? 'f' : body.sex === 'm' ? 'm' : null;
  const lang = body.lang === 'en' ? 'en' : 'ar';
  if (!sex) return json({ error: 'bad_sex' }, 400);
  if (!USERNAME_RE.test(username)) return json({ error: 'bad_username' }, 400);
  if (!KEY_RE.test(key)) return json({ error: 'bad_key' }, 400);
  if (!HOSP_RE.test(hosp) || !(await env.DB.prepare("SELECT 1 AS ok FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp).first())) return json({ error: 'bad_hospital' }, 400);
  const job = await divisionJob(env, hosp, String(body.job || ''));
  if (!job) return json({ error: 'bad_job' }, 400);
  if (!phoneKey(body.phone)) return json({ error: 'bad_phone' }, 400);

  const { pk, match } = await findOfficer(env, hosp, typed, String(body.phone || ''));
  if (!match && (!ROTATOR_NAME_RE.test(typed) || typed.split(' ').filter(Boolean).length < 2)) return json({ error: 'bad_name' }, 400);
  const name = match ? match.name : typed;
  const now = Date.now();
  const id = crypto.randomUUID();
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const pw = await sha256b64(salt + key);
  const jobName = job.name_ar || job.id;
  const note = JSON.stringify({ id, name, username, hosp, officer: true, job: jobName, verified: !!match });
  try {
    const results = await withUniqueNick(sex, lang, (tag, tagKey) => env.DB.batch([
      // name_key is private to the account: officers never receive the doctors' duty-card notifications.
      env.DB.prepare(
        `INSERT INTO accounts (id, username, pw, salt, name, name_key, phone, sex, hosp, resident_id, role, anon_tag, anon_key, anon_lang, created_at, aa_job, aa_job_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aa_user', ?, ?, ?, ?, ?, ?)`
      ).bind(id, username, pw, salt, name, 'aa:' + id, pk, sex, hosp, match ? officerLink(hosp, match.id) : null, tag, tagKey, lang, now, job.id, jobName),
      notifyApprovers(env, hosp, 'signup:' + id, 'signup_request', note, now),
    ]));
    dispatchPush(env, ctx, results[1]);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/accounts\.username/.test(msg)) return json({ error: 'username_taken' }, 409);
    if (/resident_id|idx_accounts_resident/.test(msg)) return json({ error: 'already_registered' }, 409);
    throw err;
  }
  return json({ ok: true, status: 'pending', name, verified: !!match });
}

// ---------------------------------------------------------------------------
// Notifications (stored rows + Web Push)
// ---------------------------------------------------------------------------

const RETURNING = 'RETURNING account_id, type, data, gkey, ts';

/** Notification for every active owner account and every admin account of `hosp`. */
export function notifyApprovers(env, hosp, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT id, ?1, ?2, ?3, ?4, 0 FROM accounts
      WHERE status = 'active' AND (role = 'owner' OR (role = 'admin' AND EXISTS (
            SELECT 1 FROM json_each(accounts.hospitals) WHERE value IN (?5, '*'))))
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(gkey, type, data, now, hosp);
}

/** Notification for every active resident account registered at `hosp` (e.g. the ER preferences portal opened). */
export function notifyHospitalResidents(env, hosp, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT id, ?1, ?2, ?3, ?4, 0 FROM accounts WHERE status = 'active' AND hosp = ?5 AND role IN ('user', 'anaesthesia', 'admin')
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(gkey, type, data, now, hosp);
}

export function notifyOne(env, accountId, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen) VALUES (?1, ?2, ?3, ?4, ?5, 0)
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(accountId, gkey, type, data, now);
}

const MONTH_AR = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
/** Deadline in Iraq time, e.g. "20/10 الساعة 23:59". */
function closesText(ms) {
  const d = new Date(Number(ms) + 3 * 3600 * 1000);
  if (isNaN(d)) return '';
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} الساعة ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const WEEKDAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
/** "الثلاثاء 22/10 · 8:00 م" in Iraq time. */
function startText(ms) {
  const d = new Date(Number(ms) + 3 * 3600 * 1000);
  if (isNaN(d)) return '';
  const h = d.getUTCHours();
  return `${WEEKDAY_AR[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} · ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}

const ROLE_AR = { owner: 'المالك', admin: 'مدير مستشفى', anaesthesia: 'مقيم تخدير', user: 'مقيم', rotator: 'روتيتر', aa_user: 'موظف الشؤون الإدارية', aa_admin: 'مدير الشؤون الإدارية' };

/** Lock-screen text for one notification row (the in-app list builds its own, richer text). */
function pushMessage(n) {
  let d = {};
  try { d = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data || {}); } catch {}
  const others = d.count > 1 ? ` و${d.count - 1} آخرين` : '';
  const card = d.h ? `./Home.html?hospital=${encodeURIComponent(d.h)}#thread=${encodeURIComponent(d.d || '')}|${encodeURIComponent(d.name || '')}` : './Home.html';
  switch (n.type) {
    case 'like': return { title: '❤️ إعجاب جديد', body: `${d.last || 'أحدهم'}${others} أُعجب ببطاقة خفارتك`, url: card };
    case 'comment': return { title: '💬 تعليق جديد على بطاقتك', body: `${d.last || 'أحدهم'}: ${d.text || ''}`, url: card };
    case 'reply': return { title: '↩️ ردّ على تعليقك', body: `${d.last || 'أحدهم'}: ${d.text || ''}`, url: card };
    case 'signup_request': return { title: '🆕 طلب حساب جديد', body: `${d.name || ''} (@${d.username || ''})`, url: './account.html#manage' };
    case 'reset_request': return { title: '🔑 طلب تغيير كلمة المرور', body: `${d.name || ''} (@${d.username || ''})`, url: './account.html#manage-resets' };
    case 'account_approved': return { title: '✅ تم تفعيل حسابك', body: 'أهلاً بك في بوابة المستشفيات!', url: './index.html?portal=true' };
    case 'reset_approved': return { title: '🔓 تمت الموافقة', body: 'يمكنك الآن اختيار كلمة مرور جديدة.', url: './account.html#forgot' };
    case 'role_changed': return { title: '⭐ تغيّرت صلاحياتك', body: `صلاحيتك الآن: ${ROLE_AR[d.role] || d.role || ''}`, url: './account.html' };
    case 'profile_set': return { title: '🎓 تحديث معلومات البورد', body: `حدّث ${d.by || 'مدير المستشفى'} معلومات البورد في ملفك الشخصي.`, url: './index.html?portal=true#panel=profile' };
    case 'exchange_request': return { title: '🔁 طلب تبديل خفارتك', body: `${d.by || 'أحد الزملاء'}: خفارة ${d.date || ''} إلى ${d.newName || ''}. وافق أو ارفض.`, url: './index.html?portal=true#panel=exchanges' };
    case 'exchange_admin': return { title: '🔁 طلب تبديل بانتظار موافقتك', body: `${d.date || ''}: ${d.oldName || ''} ← ${d.newName || ''}`, url: './index.html?portal=true#panel=exchanges' };
    case 'exchange_result': return {
      title: { approved: '✅ تم تبديل الخفارة', owner_approved: '👍 وافق صاحب الخفارة', owner_rejected: '❌ رُفض طلب التبديل', admin_rejected: '❌ رفضت الإدارة طلب التبديل' }[d.step] || '🔁 طلب التبديل',
      body: `خفارة ${d.date || ''}: ${d.oldName || ''} ← ${d.newName || ''}${d.note ? ' · ' + d.note : ''}`,
      url: './index.html?portal=true#panel=exchanges',
    };
    case 'warning': return { title: '⚠️ تحذير من الإدارة', body: `بسبب تعليقك: «${d.text || ''}»${d.note ? ' – ' + d.note : ''}`, url: card };
    case 'comments_barred': return { title: '🚫 تم إيقاف التعليق لحسابك', body: 'لا يمكنك التعليق على بطاقات الخفارات حالياً.', url: './index.html?portal=true' };
    case 'comments_allowed': return { title: '💬 يمكنك التعليق مجدداً', body: 'أُعيد السماح بالتعليق لحسابك.', url: './index.html?portal=true' };
    case 'contact_request': return { title: '📞 طلب تواصل', body: `${d.last || 'أحد الزملاء'} يطلب التواصل معك${d.count > 1 ? ` (${d.count} طلبات بانتظارك)` : ''}.`, url: './index.html?portal=true#panel=requests' };
    case 'er_portal': return { title: d.extended ? '🗓️ تمديد بوابة رغبات الطوارئ' : '🗓️ بوابة رغبات خفارات الطوارئ مفتوحة', body: `اختر رغباتك لجدول ${MONTH_AR[Number(String(d.ym || '').slice(5))] || ''} ${String(d.ym || '').slice(0, 4)} قبل ${closesText(d.closes)}`, url: './index.html?portal=true#panel=schedule' };
    case 'duty_reminder': return { title: `⏰ خفارتك بعد ${durationText(d.in || d.lead || 60)}`, body: `${d.title || ''} · ${startText(d.start)}${d.hospName ? ' · ' + d.hospName : ''}`, url: './index.html?portal=true#panel=duties' };
    case 'opioid_assigned': return { title: '💊 ذمة المخدرات', body: `أُسندت إليك ذمة المخدرات: ${d.place || ''}${d.hospName ? ' · ' + d.hospName : ''}.`, url: './index.html?portal=true#panel=opioids' };
    case 'opioid_used': return { title: `💉 استُخدم ${d.item || 'مخدر'}`, body: `${d.qty || 1} أمبولة · ${d.ward || ''} · سجّلها ${d.by || ''}. المتبقي: ${d.left}`, url: './index.html?portal=true#panel=opioids' };
    case 'opioid_low': return { title: `⚠️ ${d.item || 'مخدر'} قارب على النفاد`, body: `بقي ${d.left} فقط في ${d.place || ''}.`, url: './index.html?portal=true#panel=opioids' };
    case 'opioid_empty': return { title: `⛔ نفد ${d.item || 'مخدر'}`, body: `لم يبقَ شيء في ${d.place || ''}. اطلب التعويض من الإدارة.`, url: './index.html?portal=true#panel=opioids' };
    case 'opioid_handed_off': return { title: '💊 تسليم ذمة المخدرات', body: `سُلّمت ذمة ${d.place || ''} إلى ${d.to || 'مقيم آخر'}.`, url: './index.html?portal=true' };
    case 'opioid_replenished': return { title: '💊 تعويض ذمة المخدرات', body: `${d.by || 'المسؤول'} أضاف ${d.qty} من ${d.item || ''} إلى ذمة ${d.place || ''}. المتبقي ${d.left}.`, url: './index.html?portal=true#panel=opioidsadmin' };
    case 'opioid_stock': return { title: d.kind === 'withdraw' ? '💊 سحب من ذمتك' : '💊 تعويض ذمتك', body: `${d.item || ''}: ${d.kind === 'withdraw' ? 'سُحبت' : 'أُضيفت'} ${d.qty} · المتبقي ${d.left} (${d.place || ''})`, url: './index.html?portal=true#panel=opioids' };
    default: return { title: '🔔 إشعار جديد', body: '', url: './index.html?portal=true' };
  }
}

/** Sends a push for every notification row returned by an INSERT ... RETURNING, after the response. */
export function dispatchPush(env, ctx, ...stmtResults) {
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
        // ts: the phone shows a push the app has already marked read silently (and closes it); likes
        // update their grouped notification without ringing again.
        const msg = { ...pushMessage(row), tag: row.gkey, ts: row.ts || Date.now(), quiet: row.type === 'like' };
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
  // The name always follows the hospital database (also for renames made before accounts followed them).
  if (row && row.resident_id && !AA_ROLES.includes(row.role)) {
    const rec = await env.DB.prepare("SELECT json_extract(data, '$.name') AS n FROM records WHERE coll = 'resident' AND id = ?").bind(row.resident_id).first();
    if (rec && rec.n && rec.n !== row.name) {
      await env.DB.prepare("UPDATE accounts SET name = ?, name_key = CASE WHEN role = 'rotator' THEN name_key ELSE ? END WHERE id = ?").bind(rec.n, nameKey(rec.n), row.id).run();
      row.name = rec.n;
    }
  }
  const account = profile(row, await getStageMonth(env));
  if (account && !NO_PROFILE.includes(account.role)) account.profile_locked = (await hospitalList(env, 'profile_locked')).includes(row.hosp);
  return json({ ok: true, account, role: auth.r, adminHospitals: auth.h, device: auth.dv, dutyDay: dutyDayNow() });
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

/**
 * Body: { username, oldKey, newKey }. The password key is salted with the username, so the browser
 * re-derives it for the new name; the current password proves the change. Sessions stay valid.
 */
async function renameAccount(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'rename:' + auth.a, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request) || {};
  const username = String(body.username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return json({ error: 'bad_username' }, 400);
  if (!KEY_RE.test(String(body.newKey || ''))) return json({ error: 'bad_key' }, 400);
  const row = await env.DB.prepare('SELECT username, pw, salt FROM accounts WHERE id = ?').bind(auth.a).first();
  if (await sha256b64(row.salt + String(body.oldKey || '')) !== row.pw) return json({ error: 'wrong_password' }, 403);
  if (username === row.username) return json({ ok: true, username });
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET username = ?, pw = ?, salt = ? WHERE id = ?').bind(username, await sha256b64(salt + body.newKey), salt, auth.a),
      env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), `${auth.r}:${auth.name}`, `Username ${row.username} -> ${username}`),
    ]);
  } catch (err) {
    if (/accounts\.username|UNIQUE/.test(String(err && err.message))) return json({ error: 'username_taken' }, 409);
    throw err;
  }
  return json({ ok: true, username });
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
// What a hospital admin may do to an account of their hospital (see decide).
const ADMIN_ACTIONS = ['approve', 'reject', 'approve_reset', 'deny_reset', 'mute', 'unmute', 'delete', 'set_profile'];
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
    (SELECT COALESCE(json_extract(data, '$.spec'), json_extract(data, '$.dept')) FROM records WHERE coll = 'resident' AND id = accounts.resident_id) AS roster_spec,
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
  // Admins manage residents (regular / anaesthesia), rotators and division officers of their own
  // hospitals, never themselves: they answer sign-up and password requests, allow or bar commenting
  // and delete accounts. Everything else (status, role, devices, profile) is the owner's, except an
  // officer's division role.
  // Another admin of the admin's own hospital(s): only their role can be changed.
  const peerAdmin = !isOwner && row.role === 'admin' && scopeOf(row).length > 0 && scopeOf(row).every(h => h !== '*' && hospInScope(auth, h));
  if (!isOwner && (!hospInScope(auth, row.hosp) || !(ADMIN_MANAGES.includes(row.role) || peerAdmin) || row.id === auth.a)) return json({ error: 'forbidden' }, 403);
  // Admins also switch a resident between regular, anaesthesia, admin and rotator, and an officer
  // between division user and division admin; they edit residents' board information too.
  const adminMay = peerAdmin ? body.action === 'set_role'
    : ADMIN_ACTIONS.includes(String(body.action || '')) || body.action === 'set_role';
  if (!isOwner && !adminMay) return json({ error: 'forbidden' }, 403);
  // Only residents become rotators, and a rotator becomes a resident again only when the account was a
  // resident before (it is still linked to its record in the hospital database). A rotator who signed
  // up as one has no record: their type stays.
  if (body.role === 'rotator' && row.role !== 'rotator' && !RESIDENT_ROLES.includes(row.role)) return json({ error: 'forbidden' }, 403);
  if (row.role === 'rotator' && body.role !== undefined && body.role !== 'rotator' && (!row.resident_id || !RESIDENT_ROLES.includes(body.role))) return json({ error: 'rotator_fixed' }, 403);
  if (!isOwner && body.maxDevices !== undefined) return json({ error: 'forbidden' }, 403);

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
    if (isOwner) {
      role = ACCOUNT_ROLES.includes(body.role) ? body.role : row.role;
      hospitals = Array.isArray(body.hospitals) ? body.hospitals.map(String).filter(h => h === '*' || HOSP_RE.test(h)).slice(0, 50) : hospitals;
    } else {
      // Admins: regular, anaesthesia or admin for residents, division user or division admin for
      // officers, always for their own hospital; rotators stay rotators.
      const gives = AA_ROLES.includes(row.role) ? ADMIN_GIVES_AA : ADMIN_GIVES;
      if (body.hospitals !== undefined || !gives.includes(body.role) || !gives.includes(row.role)) return json({ error: 'forbidden' }, 403);
      role = body.role;
      hospitals = [row.hosp];
    }
    if (!UNSCOPED.includes(role) && !hospitals.length) hospitals = [row.hosp];
    stmts.push(env.DB.prepare('UPDATE accounts SET role = ?, hospitals = ? WHERE id = ?').bind(role, JSON.stringify(UNSCOPED.includes(role) ? [] : hospitals), row.id));
    // A rotator's name key is private to the account, so its duty cards are never theirs; a resident
    // again takes the key of their name back (their duty cards, likes and comments).
    if (role === 'rotator' && row.role !== 'rotator') stmts.push(env.DB.prepare('UPDATE accounts SET name_key = ? WHERE id = ?').bind('rotator:' + row.id, row.id));
    if (role !== 'rotator' && row.role === 'rotator') stmts.push(env.DB.prepare('UPDATE accounts SET name_key = ? WHERE id = ?').bind(nameKey(row.name), row.id));
  }
  if (body.maxDevices !== undefined) {
    const n = Math.max(0, Math.min(20, Math.floor(Number(body.maxDevices) || 0)));
    stmts.push(env.DB.prepare('UPDATE accounts SET max_devices = ? WHERE id = ?').bind(n, row.id));
  }

  switch (action) {
    case 'approve':
      if (row.status !== 'pending') return json({ error: 'not_pending' }, 409);
      // An officer who was not in the division's database yet is added under the job title they chose.
      if (AA_ROLES.includes(role) && !row.resident_id && row.aa_job) {
        const added = await addOfficer(env, { hosp: row.hosp, name: row.name, phone: row.phone, job: row.aa_job, by });
        stmts.push(env.DB.prepare('UPDATE accounts SET resident_id = ?, name = ? WHERE id = ?').bind(added.link, added.name, row.id));
      }
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
      if (body.role === undefined) return json({ error: 'bad_request' }, 400);
      if (role !== row.role || JSON.stringify(hospitals) !== JSON.stringify(scopeOf(row))) {
        notes.push(stmts.push(notifyOne(env, row.id, 'role', 'role_changed', JSON.stringify({ role, hospitals }), now)) - 1);
      }
      break;
    case 'set_devices':
      if (body.maxDevices === undefined) return json({ error: 'bad_request' }, 400);
      break;
    case 'mute':
    case 'unmute':
      stmts.push(env.DB.prepare('UPDATE accounts SET no_comment = ? WHERE id = ?').bind(action === 'mute' ? 1 : 0, row.id));
      notes.push(stmts.push(notifyOne(env, row.id, 'comments', action === 'mute' ? 'comments_barred' : 'comments_allowed', JSON.stringify({ by: auth.name || null }), now)) - 1);
      break;
    case 'set_profile': {
      // Rotators and officers have no board, specialty or stage: only sex and hospital (the owner's).
      if (!isOwner && NO_PROFILE.includes(row.role)) return json({ error: 'no_profile' }, 400);
      const p = NO_PROFILE.includes(row.role) ? { board: null, specialty: null, stage: null, boardYears: null } : cleanProfile(body.profile || {});
      if (p.error) return json({ error: p.error }, 400);
      // A hospital admin edits the board information of their residents; sex and hospital stay the owner's.
      const sex = isOwner && body.profile && (body.profile.sex === 'm' || body.profile.sex === 'f') ? body.profile.sex : row.sex;
      const hosp = isOwner && body.profile && HOSP_RE.test(String(body.profile.hosp || '')) ? String(body.profile.hosp) : row.hosp;
      stmts.push(env.DB.prepare(
        `UPDATE accounts SET board = ?, specialty = ?, stage = ?, stage_ref = ?, board_years = ?, profile_src = ?, sex = ?, hosp = ? WHERE id = ?`
      ).bind(p.board, p.specialty, p.stage, p.stage === null ? null : now, p.boardYears, isOwner ? 'owner' : 'admin', sex, hosp, row.id));
      if (p.board !== row.board || p.stage !== row.stage || p.boardYears !== row.board_years) {
        notes.push(stmts.push(notifyOne(env, row.id, 'profile', 'profile_set', JSON.stringify({ by: auth.name || null }), now)) - 1);
      }
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
      if (row.id === auth.a) return json({ error: 'forbidden' }, 403);
      stmts.push(
        env.DB.prepare('DELETE FROM likes WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM notifications WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM account_devices WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM push_subs WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM duty_reminders WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM duty_reminder_queue WHERE account_id = ?').bind(row.id),
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
  if (action === 'approve' && role === 'rotator' && !row.resident_id) {
    await ensureRotatorRecord(env, { id: row.id, name: row.name, phone: row.phone, hosp: row.hosp }, by)
      .catch(err => console.error('rotator entry', row.id, err && err.message));
  }
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

// Option counts per avatar part (must match hub-avatar.js, version 2).
// Avataaars-style avatars (hub-avatar.js, built by tools/avatar): option counts per key.
const AVATAR_VERSION = 3;
const AVATAR_LIMITS = { t: 40, hc: 15, tc: 21, a: 10, f: 8, fc: 10, c: 13, cc: 21, g: 14, e: 13, b: 13, m: 12, s: 10, k: 14 };

export function cleanAvatar(input) {
  if (!input || typeof input !== 'object') return null;
  const out = { v: AVATAR_VERSION };
  for (const [k, n] of Object.entries(AVATAR_LIMITS)) {
    const v = Math.floor(Number(input[k]));
    out[k] = Number.isFinite(v) && v >= 0 && v < n ? v : 0;
  }
  return out;
}

function parseAvatar(text) {
  if (!text) return null;
  try {
    const a = JSON.parse(text);
    // Designs from the first avatar version used other option lists: show the default figure instead.
    return a && a.v === AVATAR_VERSION ? cleanAvatar(a) : null;
  } catch { return null; }
}

async function saveAvatar(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (await overLimit(env, 'avatar:' + auth.a, 40)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request) || {};
  const avatar = body.avatar === null ? null : cleanAvatar(body.avatar);
  if (body.avatar !== null && !avatar) return json({ error: 'bad_avatar' }, 400);
  const row = await env.DB.prepare('SELECT sex FROM accounts WHERE id = ?').bind(auth.a).first();
  if (avatar && row.sex === 'f') avatar.f = 0; // no beard or moustache
  await env.DB.prepare('UPDATE accounts SET avatar = ? WHERE id = ?').bind(avatar ? JSON.stringify(avatar) : null, auth.a).run();
  return json({ ok: true, avatar });
}

/**
 * The board information of a hospital's resident accounts, for the ER page: the accounts are its
 * source, so the ER residents' board and stage follow them (matched by the hospital record or phone).
 */
async function erProfiles(env, auth, url) {
  const hosp = String(url.searchParams.get('h') || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  if (!(await canUseEr(env, auth, hosp))) return json({ error: 'forbidden' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT id, resident_id, phone, sex, board, specialty, stage, stage_ref, board_years FROM accounts
      WHERE hosp = ? AND status = 'active' AND role IN ('user', 'anaesthesia', 'admin')`
  ).bind(hosp).all();
  const month = await getStageMonth(env);
  return json({ ok: true, profiles: results.map(r => ({
    id: r.id, resident_id: r.resident_id, phone: r.phone, sex: r.sex, board: r.board, specialty: r.specialty,
    stage_now: currentStage(r.stage, r.stage_ref, r.board_years, month), board_years: r.board_years,
  })) });
}

/**
 * The residents census of a hospital (owner and the hospital's admins): the board information of every
 * resident of its database who has an account, with the stage as it is today. Residents without an
 * account have none (the census lists them as not set).
 */
async function census(env, auth, url) {
  const hosp = String(url.searchParams.get('h') || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  if (!(auth.r === 'owner' || (auth.r === 'admin' && hospInScope(auth, hosp)))) return json({ error: 'forbidden' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT resident_id, role, board, specialty, stage, stage_ref, board_years FROM accounts
      WHERE status = 'active' AND resident_id IN (
        SELECT id FROM records WHERE coll = 'resident' AND EXISTS (SELECT 1 FROM json_each(records.data, '$.hospitals') h WHERE h.value = ?1))`
  ).bind(hosp).all();
  const month = await getStageMonth(env);
  return json({ ok: true, profiles: (results || []).map(r => ({
    resident_id: r.resident_id, role: r.role, board: r.board, specialty: r.specialty, board_years: r.board_years,
    stage: currentStage(r.stage, r.stage_ref, r.board_years, month),
  })) });
}

/** A hospital's specialty was renamed: the accounts of that hospital that named it follow. */
async function renameSpecialty(request, env, auth) {
  const body = await readJson(request) || {};
  const hosp = String(body.hosp || '');
  const from = plainText(body.from, 80), to = plainText(body.to, 80);
  if (!HOSP_RE.test(hosp) || !from || !to) return json({ error: 'bad_request' }, 400);
  if (!(auth.r === 'owner' || (auth.r === 'admin' && hospInScope(auth, hosp)))) return json({ error: 'forbidden' }, 403);
  const res = await env.DB.prepare('UPDATE accounts SET specialty = ? WHERE hosp = ? AND specialty = ?').bind(to, hosp, from).run();
  return json({ ok: true, updated: res.meta && res.meta.changes || 0 });
}

async function profileSuggest(env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (NO_PROFILE.includes(auth.r)) return json({ ok: true, suggestion: { board: null, specialty: null, stage: null, sex: null, source: [] } });
  const row = await env.DB.prepare('SELECT name, hosp, resident_id, phone FROM accounts WHERE id = ?').bind(auth.a).first();
  const s = await suggestProfile(env, { name: row.name, hosp: row.hosp, residentId: row.resident_id, phone: row.phone });
  return json({ ok: true, suggestion: s });
}

async function saveProfile(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (NO_PROFILE.includes(auth.r)) return json({ error: 'no_profile' }, 400);
  // The hospital's admins may keep the board information to themselves (switch in the hospital settings).
  const mine = await env.DB.prepare('SELECT hosp FROM accounts WHERE id = ?').bind(auth.a).first();
  if (mine && (await hospitalList(env, 'profile_locked')).includes(mine.hosp)) return json({ error: 'profile_locked' }, 403);
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
      `SELECT c.cid, c.parent_cid, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex, a.avatar AS avatar
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
      'SELECT nid, gkey, type, data, ts, seen FROM notifications WHERE account_id = ?1 AND ts > ?2 ORDER BY ts DESC LIMIT 40'
    ).bind(auth.a, since));
    stmts.push(env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND seen = 0').bind(auth.a));
  }
  if (canApprove(auth)) {
    const scope = seesAll(auth) ? '' : ' AND hosp IN (SELECT value FROM json_each(?1))';
    stmts.push(env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM accounts WHERE status = 'pending'${scope}) AS accounts,
              (SELECT COUNT(*) FROM accounts WHERE reset = 'requested'${scope}) AS resets,
              (SELECT COUNT(*) FROM exchange_requests WHERE status = 'admin_pending'${scope}) AS exchanges`
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

/** Body: { nids: [..] } removes those notifications of this account, {} removes them all. */
async function clearNotifications(request, env, auth) {
  if (!auth.a) return json({ ok: true });
  const body = await readJson(request) || {};
  if (Array.isArray(body.nids)) {
    await env.DB.prepare('DELETE FROM notifications WHERE account_id = ?1 AND nid IN (SELECT value FROM json_each(?2))')
      .bind(auth.a, JSON.stringify(body.nids.map(Number).slice(0, 200))).run();
  } else {
    await env.DB.prepare('DELETE FROM notifications WHERE account_id = ?').bind(auth.a).run();
  }
  return json({ ok: true });
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
  // On-call statuses of these cards (and, on the reader's own card, the open contact requests).
  const statuses = await cardStatuses(env, [...new Set(valid.map(c => c.target))], auth && auth.a && auth.r !== 'rotator' ? nameKey(auth.name || '') : null)
    .catch(() => new Map());
  const out = {};
  names.forEach((n, i) => {
    const r = cards[i] && byTarget.get(cards[i].target);
    if (r) out[n] = { likes: r.likes, comments: r.comments, mine: !!r.mine };
    const st = cards[i] && statuses.get(cards[i].target);
    if (st) out[n] = { ...(out[n] || { likes: 0, comments: 0, mine: false }), st };
  });
  return json({ ok: true, cards: out, canReact: !!(auth && auth.a) });
}

const canModerate = (auth, hosp) => auth.r === 'owner' || (auth.r === 'admin' && hospInScope(auth, hosp));
/** A moderator may warn the author of a comment: never themselves; admins only their hospital's residents. */
const canWarn = (auth, c) => !!c.account_id && c.account_id !== auth.a && canModerate(auth, c.hosp)
  && (auth.r === 'owner' || ADMIN_MANAGES.includes(c.role));

// Commenting, and anonymous commenting, switched off per hospital (kv 'comments_off' / 'anon_off':
// JSON arrays of hospital ids).
async function hospitalList(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  try { const v = JSON.parse((row && row.v) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
const commentsOff = env => hospitalList(env, 'comments_off');
const anonOff = env => hospitalList(env, 'anon_off');

/** Why this account cannot comment on this hospital's cards (null: it can). The owner always can. */
async function commentBlock(env, auth, hosp) {
  if (auth.r === 'owner') return null;
  if ((await commentsOff(env)).includes(hosp)) return 'comments_off';
  const row = await env.DB.prepare('SELECT no_comment FROM accounts WHERE id = ?').bind(auth.a).first();
  return row && row.no_comment ? 'comment_blocked' : null;
}

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
    sex: c.anon ? null : (c.sex || null),
    avatar: c.anon ? null : parseAvatar(c.avatar),
    // Only moderators (the owner, the hospital's admins) see who is behind a nickname (to deal with abuse).
    realName: c.anon && canModerate(auth, c.hosp) ? c.name : undefined,
    warned: canModerate(auth, c.hosp) ? !!c.warned_at : undefined,
    canWarn: canWarn(auth, c),
    body: c.body,
    ts: c.ts,
    mine,
    parent: c.parent_cid || null,
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
      `SELECT a.name AS name, a.sex AS sex, a.avatar AS avatar, l.ts AS ts, l.account_id = ?2 AS mine FROM likes l JOIN accounts a ON a.id = l.account_id
        WHERE l.target = ?1 ORDER BY l.ts DESC LIMIT 300`
    ).bind(card.target, auth.a || ''),
    env.DB.prepare(
      `SELECT c.cid, c.parent_cid, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, c.warned_at, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex, a.avatar AS avatar, a.role AS role
         FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.target = ?1 AND c.deleted = 0 ORDER BY c.cid LIMIT 300`
    ).bind(card.target),
  ]);
  const block = auth.a ? await commentBlock(env, auth, card.hosp) : null;
  const anonAllowed = auth.r === 'owner' || !(await anonOff(env)).includes(card.hosp);
  return json({
    ok: true,
    likes: likesRes.results.map(l => ({ name: l.name, sex: l.sex, avatar: parseAvatar(l.avatar), ts: l.ts, mine: !!l.mine })),
    comments: commentsRes.results.map(c => commentView(c, auth)),
    canReact: !!auth.a,
    canComment: !!auth.a && !block,
    blocked: block,
    anonAllowed,
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
    `SELECT c.cid, c.parent_cid, c.target, c.hosp, c.account_id, c.anon, c.body, c.ts, c.edited_at, c.card_date, c.warned_at, a.name AS name, a.anon_tag AS anon_tag, a.sex AS sex, a.avatar AS avatar, a.role AS role
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
function notifyCardOwners(env, card, actorId, type, extra, now, alsoSkip = '') {
  const gkey = `${type}:${card.target}`;
  const countSql = type === 'like'
    ? '(SELECT COUNT(*) FROM likes WHERE target = ?1)'
    : '(SELECT COUNT(*) FROM comments WHERE target = ?1 AND deleted = 0)';
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT a.id, ?2, ?3, json_object('h', ?4, 'd', ?5, 'name', ?6, 'count', ${countSql}, 'last', ?7, 'text', ?8), ?9, 0
       FROM accounts a WHERE a.name_key = ?10 AND a.status = 'active' AND a.id <> ?11 AND a.id <> ?12
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     ${RETURNING}`
  ).bind(card.target, gkey, type, card.hosp, card.date, card.name, extra.last, extra.text || null, now, card.key, actorId, alsoSkip || '');
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
  const block = await commentBlock(env, auth, card.hosp);
  if (block) return json({ error: block }, 403);
  const anon = !!body.anon;
  if (anon && auth.r !== 'owner' && (await anonOff(env)).includes(card.hosp)) return json({ error: 'anon_off' }, 403);
  if (await overLimit(env, 'comment:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);
  const now = Date.now();
  // A reply answers a comment on the same card; replies to replies join the same conversation (one level).
  let parent = null;
  if (body.parentCid) {
    parent = await env.DB.prepare('SELECT cid, parent_cid, account_id FROM comments WHERE cid = ? AND target = ? AND deleted = 0')
      .bind(Number(body.parentCid) || 0, card.target).first();
    if (!parent) return json({ error: 'parent_not_found' }, 404);
  }
  const parentCid = parent ? (parent.parent_cid || parent.cid) : null;
  const who = anon ? auth.anon : auth.name;
  const replyTo = parent && parent.account_id !== auth.a ? parent.account_id : '';
  const stmts = [
    env.DB.prepare('INSERT INTO comments (target, hosp, account_id, anon, body, ts, card_key, card_date, parent_cid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING cid')
      .bind(card.target, card.hosp, auth.a, anon ? 1 : 0, text, now, card.key, card.date, parentCid),
    notifyCardOwners(env, card, auth.a, 'comment', { last: who, text: text.slice(0, 120) }, now, replyTo),
  ];
  if (replyTo) {
    stmts.push(notifyOne(env, replyTo, 'reply:' + parent.cid, 'reply',
      JSON.stringify({ h: card.hosp, d: card.date, name: card.name, last: who, text: text.slice(0, 120), parent: parent.cid }), now));
  }
  const [ins, notes, replyNote] = await env.DB.batch(stmts);
  dispatchPush(env, ctx, notes, replyNote);
  return json({
    ok: true,
    comment: {
      cid: ins.results[0].cid, parent: parentCid, author: anon ? auth.anon : auth.name, anon, body: text, ts: now, mine: true, canEdit: true, canDelete: true, edited: false,
      sex: anon ? null : auth.sex, avatar: anon ? null : parseAvatar(auth.avatar),
    },
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
  const row = await env.DB.prepare('SELECT cid, hosp, account_id, card_date FROM comments WHERE cid = ? AND deleted = 0').bind(Number(body.cid) || 0).first();
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.account_id !== auth.a) return json({ error: 'forbidden' }, 403);
  if (!dutyOpen(row.card_date)) return json({ error: 'duty_closed' }, 409);
  const block = await commentBlock(env, auth, row.hosp);
  if (block) return json({ error: block }, 403);
  const now = Date.now();
  await env.DB.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE cid = ?').bind(text, now, row.cid).run();
  return json({ ok: true, body: text, edited_at: now });
}

/**
 * A moderator warns the author of a comment (anonymous or not): the author gets a notification
 * (and a push) about that comment, with the moderator's note. Body: { cid, note? }
 */
async function warnComment(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const row = await env.DB.prepare(
    `SELECT c.cid, c.hosp, c.account_id, c.body, c.target, c.card_date, c.warned_at, a.role AS role
       FROM comments c JOIN accounts a ON a.id = c.account_id WHERE c.cid = ? AND c.deleted = 0`
  ).bind(Number(body.cid) || 0).first();
  if (!row) return json({ error: 'not_found' }, 404);
  if (!canWarn(auth, row)) return json({ error: 'forbidden' }, 403);
  if (await overLimit(env, 'warn:' + (auth.a || auth.r), 60)) return json({ error: 'rate_limited' }, 429);
  const note = plainText(body.note, 300) || '';
  const now = Date.now();
  const by = auth.a ? `${auth.r}:${auth.name || auth.a}` : auth.r;
  // The card's resident (for the notification's text and its link to the thread).
  const key = row.target.split(':').slice(3).join(':');
  const owner = await env.DB.prepare('SELECT name FROM accounts WHERE name_key = ? LIMIT 1').bind(key).first();
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE comments SET warned_at = ?, warned_by = ? WHERE cid = ?').bind(now, by, row.cid),
    ...(row.warned_at ? [] : [env.DB.prepare('UPDATE accounts SET warnings = warnings + 1 WHERE id = ?').bind(row.account_id)]),
    notifyOne(env, row.account_id, 'warn:' + row.cid, 'warning', JSON.stringify({
      h: row.hosp, d: row.card_date, name: (owner && owner.name) || key, text: String(row.body).slice(0, 160), note, role: auth.r,
    }), now),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(now, by, `Comment ${row.cid} warned (${row.hosp})`),
  ]);
  dispatchPush(env, ctx, results[results.length - 2]);
  return json({ ok: true, warned: true });
}

/** Hospitals where commenting is off, and which of them this moderator may switch. */
async function commentSwitches(env, auth) {
  if (!canApprove(auth)) return json({ error: 'forbidden' }, 403);
  return json({ ok: true, off: await commentsOff(env), anonOff: await anonOff(env), profileLocked: await hospitalList(env, 'profile_locked'), scope: seesAll(auth) ? ['*'] : (auth.h || []) });
}

/**
 * Body: { hosp, on } switches commenting, { hosp, anon } anonymous commenting, { hosp, profileEdit }
 * whether residents edit their own board information. The owner switches any hospital, an admin their own.
 */
async function setCommentSwitch(request, env, auth) {
  const body = await readJson(request) || {};
  const hosp = String(body.hosp || '');
  const anonSwitch = typeof body.anon === 'boolean';
  const profileSwitch = typeof body.profileEdit === 'boolean';
  if (!HOSP_RE.test(hosp) || (!anonSwitch && !profileSwitch && typeof body.on !== 'boolean')) return json({ error: 'bad_request' }, 400);
  if (!canModerate(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const key = profileSwitch ? 'profile_locked' : anonSwitch ? 'anon_off' : 'comments_off';
  const on = profileSwitch ? body.profileEdit : anonSwitch ? body.anon : body.on;
  const off = new Set(await hospitalList(env, key));
  if (on) off.delete(hosp); else off.add(hosp);
  const by = auth.a ? `${auth.r}:${auth.name || auth.a}` : auth.r;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(key, JSON.stringify([...off])),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), by, `${profileSwitch ? 'Residents edit their board info' : anonSwitch ? 'Anonymous comments' : 'Comments'} ${on ? 'on' : 'off'} (${hosp})`),
  ]);
  return json({ ok: true, off: await commentsOff(env), anonOff: await anonOff(env), profileLocked: await hospitalList(env, 'profile_locked') });
}

// ---------------------------------------------------------------------------
// The hospital database is the source of a resident's identity
// ---------------------------------------------------------------------------

/**
 * A resident record was changed (by the hospital's admins or the owner): the linked account follows
 * it (name, phone, hospital), and on a rename the duty cards keep their history. The roster's duty
 * entries of every month are renamed (the client normally did that in the same save; this catches
 * any it missed), and likes and comments move to the new name so the resident's totals stay the same.
 * Old and new are the record's data before and after.
 */
export async function mirrorResident(env, id, before, after, by) {
  const now = Date.now();
  const oldName = String(before.name || ''), newName = String(after.name || '');
  const oldKey = nameKey(oldName), newKey = nameKey(newName);
  const hospitals = [...new Set([...(before.hospitals || []), ...(after.hospitals || [])].map(String))].filter(h => HOSP_RE.test(h));
  const pk = phoneKey(after.phone);
  const stmts = [];
  const hosps = Array.isArray(after.hospitals) && after.hospitals.length ? after.hospitals.map(String) : null;
  stmts.push(env.DB.prepare(
    `UPDATE accounts SET name = ?1, name_key = CASE WHEN role = 'rotator' THEN name_key ELSE ?2 END, phone = COALESCE(?3, phone),
            hosp = CASE WHEN ?4 IS NULL OR hosp IN (SELECT value FROM json_each(?4)) THEN hosp ELSE json_extract(?4, '$[0]') END
      WHERE resident_id = ?5 AND role NOT IN ('aa_user', 'aa_admin')`
  ).bind(newName, newKey, pk || null, hosps ? JSON.stringify(hosps) : null, id));

  if (oldName && newName && oldName !== newName && oldKey && newKey && hospitals.length) {
    // Two residents sharing the old name in these hospitals: their duties cannot be told apart.
    const { results: others } = await env.DB.prepare(
      "SELECT json_extract(data, '$.name') AS n, json_extract(data, '$.hospitals') AS hs FROM records WHERE coll = 'resident' AND id <> ?"
    ).bind(id).all();
    const ambiguous = others.some(o => {
      let hs = [];
      try { hs = JSON.parse(o.hs || '[]'); } catch {}
      return nameKey(o.n) === oldKey && hs.some(h => hospitals.includes(h));
    });
    if (!ambiguous) {
      const hj = JSON.stringify(hospitals);
      const { results: names } = await env.DB.prepare(
        "SELECT DISTINCT json_extract(data, '$.name') AS n FROM records WHERE coll = 'sched' AND hosp IN (SELECT value FROM json_each(?1))"
      ).bind(hj).all();
      const variants = names.map(r => r.n).filter(n => n && n !== newName && nameKey(n) === oldKey);
      if (variants.length) {
        const where = `coll = 'sched' AND hosp IN (SELECT value FROM json_each(?1)) AND json_extract(data, '$.name') IN (SELECT value FROM json_each(?2))`;
        const msg = `Resident renamed: ${oldName} -> ${newName}`;
        stmts.push(
          env.DB.prepare(`INSERT INTO history (coll, id, hosp, v, data, deleted, ts, by, msg) SELECT coll, id, hosp, v, data, 0, ?3, ?4, ?5 FROM records WHERE ${where}`)
            .bind(hj, JSON.stringify(variants), now, by, msg),
          env.DB.prepare(`UPDATE records SET data = json_set(data, '$.name', ?3), v = v + 1, updated_at = ?4, updated_by = ?5, wid = NULL WHERE ${where}`)
            .bind(hj, JSON.stringify(variants), newName, now, by),
        );
      }
      if (oldKey !== newKey) {
        // Duty cards are "duty:<hospital>:<date>:<name key>".
        stmts.push(
          env.DB.prepare(
            `UPDATE comments SET card_key = ?2, target = 'duty:' || hosp || ':' || card_date || ':' || ?2
              WHERE card_key = ?1 AND hosp IN (SELECT value FROM json_each(?3))`
          ).bind(oldKey, newKey, hj),
          env.DB.prepare(
            `UPDATE OR IGNORE likes SET card_key = ?2, target = substr(target, 1, length(target) - length(?1)) || ?2
              WHERE card_key = ?1 AND EXISTS (SELECT 1 FROM json_each(?3) h WHERE likes.target LIKE 'duty:' || h.value || ':%')`
          ).bind(oldKey, newKey, hj),
          // A like on both the old and the new card by the same person: the old one goes.
          env.DB.prepare(
            `DELETE FROM likes WHERE card_key = ?1 AND EXISTS (SELECT 1 FROM json_each(?2) h WHERE likes.target LIKE 'duty:' || h.value || ':%')`
          ).bind(oldKey, hj),
        );
      }
    }
  }
  await env.DB.batch(stmts);
}
