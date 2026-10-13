/**
 * Personal accounts: sign-up checked against the roster, approval by the owner or the hospital's
 * admins, sign-in, approved password resets, notifications, and likes / comments on duty cards.
 *
 * Password handling: the browser sends `key` = base64(PBKDF2-SHA256(password, "hosp-hub/v1/" +
 * username, 310 000 rounds)). The slow part therefore runs on the phone, which keeps the Worker
 * inside the free plan's 10 ms CPU budget; the server stores SHA-256(salt || key) with a random salt.
 */

import { DAY, json, readJson, signToken, sha256b64, b64, hmac, overLimit, bucketOf, plainText } from './lib.js';
import { nameKey, namesMatch, phoneKey, isoDate } from './names.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,23}$/;
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes, base64
const HOSP_RE = /^[\w-]{1,48}$/;
const ACCOUNT_ROLES = ['user', 'anaesthesia', 'admin', 'owner'];
const RESET_VALID_MS = 3 * DAY;
const PUBLIC_FIELDS = 'id, username, name, phone, hosp, resident_id, role, hospitals, status, reset, reset_at, created_at, decided_at, decided_by, last_seen';

/** Routes under /api/accounts, /api/notifications and /api/social. Returns null when not matched. */
export async function routeAccounts(path, method, request, env, auth, url) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  switch (`${method} ${path}`) {
    case 'POST /api/accounts/check': return checkIdentity(request, env, ip);
    case 'GET /api/accounts/username': return usernameFree(env, url, ip);
    case 'POST /api/accounts/signup': return signup(request, env, ip);
    case 'POST /api/accounts/login': return accountLogin(request, env, ip);
    case 'POST /api/accounts/forgot': return forgot(request, env, ip);
    case 'POST /api/accounts/reset': return resetPassword(request, env, ip);
    case 'GET /api/social': return socialSummary(env, auth, url);
  }
  if (!auth) {
    return path.startsWith('/api/accounts') || path.startsWith('/api/notifications') || path.startsWith('/api/social')
      ? json({ error: 'unauthorized' }, 401) : null;
  }
  switch (`${method} ${path}`) {
    case 'GET /api/accounts/me': return me(env, auth);
    case 'POST /api/accounts/password': return changePassword(request, env, auth);
    case 'GET /api/accounts': return listAccounts(env, auth, url);
    case 'POST /api/accounts/decide': return decide(request, env, auth);
    case 'GET /api/notifications': return listNotifications(env, auth, url);
    case 'POST /api/notifications/seen': return markSeen(request, env, auth);
    case 'GET /api/social/thread': return thread(env, auth, url);
    case 'POST /api/social/like': return like(request, env, auth);
    case 'POST /api/social/comment': return addComment(request, env, auth);
    case 'POST /api/social/comment/delete': return deleteComment(request, env, auth);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tokens for accounts
// ---------------------------------------------------------------------------

export function scopeOf(row) {
  if (row.role === 'owner') return ['*'];
  if (row.role === 'user') return [];
  try { return JSON.parse(row.hospitals || '[]'); } catch { return []; }
}

export async function issueAccountToken(env, row, remember) {
  const exp = Date.now() + (remember === false ? DAY : 30 * DAY);
  const payload = { r: row.role, h: scopeOf(row), e: exp, a: row.id, s: row.sess };
  return { token: await signToken(env, payload), exp };
}

/**
 * Called by authenticate() for tokens that carry an account id. Role and hospitals always come
 * from the database, so approvals, promotions and bans take effect on the next request.
 */
export async function resolveAccountAuth(env, payload) {
  const row = await env.DB.prepare('SELECT id, role, hospitals, status, sess, name, hosp FROM accounts WHERE id = ?').bind(payload.a).first();
  if (!row || row.status !== 'active' || row.sess !== payload.s) return null;
  return { r: row.role, h: scopeOf(row), e: payload.e, a: row.id, name: row.name, hosp: row.hosp };
}

function profile(row) {
  if (!row) return null;
  const { pw, salt, ...rest } = row;
  return { ...rest, hospitals: scopeOf(row) };
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

/** Finds the roster entry for a hospital + name + phone. Never tells which part did not match. */
async function findResident(env, hosp, name, phone) {
  const pk = phoneKey(phone);
  if (!pk || !HOSP_RE.test(hosp) || !name) return { hospOk: false, match: null };
  const cleanPhone = "replace(replace(replace(COALESCE(?, ''), ' ', ''), '-', ''), '+', '')";
  const [hospRow, residents, names] = await env.DB.batch([
    env.DB.prepare("SELECT 1 AS ok FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
    env.DB.prepare(
      `SELECT id, json_extract(data, '$.name') AS name, json_extract(data, '$.phone') AS phone, json_extract(data, '$.hospitals') AS hospitals
         FROM records WHERE coll = 'resident' AND ${cleanPhone.replace('?', "json_extract(data, '$.phone')")} LIKE '%' || ?1`
    ).bind(pk),
    env.DB.prepare(
      `SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.name') AS name, json_extract(j.value, '$.phone') AS phone
         FROM records r, json_each(r.data, '$.names') j
        WHERE r.coll = 'hospital' AND r.id = ?2 AND ${cleanPhone.replace('?', "json_extract(j.value, '$.phone')")} LIKE '%' || ?1`
    ).bind(pk, hosp),
  ]);
  if (!hospRow.results.length) return { hospOk: false, match: null };
  const inHospital = r => {
    try { return (JSON.parse(r.hospitals || '[]') || []).includes(hosp); } catch { return false; }
  };
  const candidates = [
    ...names.results,
    ...residents.results.filter(inHospital),
  ];
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
  return json({ ok: true, match: true, taken: !!taken, name: match.name });
}

async function usernameFree(env, url, ip) {
  if (await overLimit(env, 'uname:' + ip, 120)) return json({ error: 'rate_limited' }, 429);
  const u = String(url.searchParams.get('u') || '').trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return json({ ok: true, valid: false, free: false });
  const row = await env.DB.prepare('SELECT 1 AS t FROM accounts WHERE username = ?').bind(u).first();
  return json({ ok: true, valid: true, free: !row });
}

async function signup(request, env, ip) {
  if (await overLimit(env, 'signup:' + ip, 10)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  const hosp = String(body.hosp || '');
  if (!USERNAME_RE.test(username)) return json({ error: 'bad_username' }, 400);
  if (!KEY_RE.test(key)) return json({ error: 'bad_key' }, 400);

  const { hospOk, match, pk } = await findResident(env, hosp, String(body.name || ''), String(body.phone || ''));
  if (!hospOk || !match) return json({ error: 'no_match' }, 400);

  const now = Date.now();
  const id = crypto.randomUUID();
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const pw = await sha256b64(salt + key);
  const note = JSON.stringify({ id, name: match.name, username, hosp });
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO accounts (id, username, pw, salt, name, name_key, phone, hosp, resident_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, username, pw, salt, match.name, nameKey(match.name), pk, hosp, match.id || null, now),
      notifyApprovers(env, hosp, 'signup:' + id, 'signup_request', note, now),
    ]);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/accounts\.username/.test(msg)) return json({ error: 'username_taken' }, 409);
    if (/resident_id|idx_accounts_resident/.test(msg)) return json({ error: 'already_registered' }, 409);
    throw err;
  }
  return json({ ok: true, status: 'pending', name: match.name });
}

/** Notification for every active owner account and every admin account of `hosp`. */
function notifyApprovers(env, hosp, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT id, ?1, ?2, ?3, ?4, 0 FROM accounts
      WHERE status = 'active' AND (role = 'owner' OR (role = 'admin' AND EXISTS (
            SELECT 1 FROM json_each(accounts.hospitals) WHERE value IN (?5, '*'))))
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0`
  ).bind(gkey, type, data, now, hosp);
}

function notifyOne(env, accountId, gkey, type, data, now) {
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen) VALUES (?1, ?2, ?3, ?4, ?5, 0)
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0`
  ).bind(accountId, gkey, type, data, now);
}

// ---------------------------------------------------------------------------
// Sign-in, password change, forgotten password
// ---------------------------------------------------------------------------

async function failures(env, key) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM rate_limit WHERE k = ? AND bucket >= ?')
    .bind(key, bucketOf(Date.now()) - 1).first();
  return row ? row.n : 0;
}

async function accountLogin(request, env, ip) {
  const body = await readJson(request);
  if (!body) return json({ success: false, error: 'bad_request' }, 400);
  const username = String(body.username || '').trim().toLowerCase();
  const key = String(body.key || '');
  if ((await failures(env, 'alogin:' + ip)) >= 40 || (await failures(env, 'alogin-u:' + username)) >= 10) {
    return json({ success: false, error: 'محاولات كثيرة خاطئة. يرجى الانتظار 10 دقائق ثم المحاولة مجدداً.' }, 429);
  }
  const row = USERNAME_RE.test(username) ? await env.DB.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first() : null;
  const hash = await sha256b64((row ? row.salt : 'x') + key);
  if (!row || hash !== row.pw || !KEY_RE.test(key)) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO rate_limit (k, bucket, n) VALUES (?, ?, 1) ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1').bind('alogin:' + ip, bucketOf(Date.now())),
      env.DB.prepare('INSERT INTO rate_limit (k, bucket, n) VALUES (?, ?, 1) ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1').bind('alogin-u:' + username, bucketOf(Date.now())),
    ]);
    return json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  if (row.status === 'pending') return json({ success: false, status: 'pending', error: 'حسابك بانتظار موافقة مشرف المستشفى.' });
  if (row.status !== 'active') return json({ success: false, status: row.status, error: 'هذا الحساب غير مفعّل. تواصل مع مشرف المستشفى.' });

  const { token, exp } = await issueAccountToken(env, row, body.remember);
  await env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').bind(Date.now(), row.id).run();
  return json({ success: true, role: row.role, adminHospitals: scopeOf(row), token, exp, account: profile(row) });
}

async function me(env, auth) {
  if (!auth.a) return json({ ok: true, account: null, role: auth.r, adminHospitals: auth.h });
  const row = await env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounts WHERE id = ?`).bind(auth.a).first();
  return json({ ok: true, account: profile(row), role: auth.r, adminHospitals: auth.h });
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
  const { token, exp } = await issueAccountToken(env, updated, true);
  return json({ ok: true, token, exp });
}

/** Always answers the same way, so it cannot be used to find out who has an account. */
async function forgot(request, env, ip) {
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
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET reset = 'requested', reset_at = ? WHERE id = ?").bind(now, row.id),
      notifyApprovers(env, row.hosp, 'reset:' + row.id, 'reset_request', JSON.stringify({ id: row.id, name: row.name, username, hosp: row.hosp }), now),
    ]);
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
// Approvals (owner, and admins for their own hospitals)
// ---------------------------------------------------------------------------

const canApprove = auth => auth.r === 'owner' || auth.r === 'admin';
const hospInScope = (auth, hosp) => auth.r === 'owner' || (auth.h || []).includes('*') || (auth.h || []).includes(hosp);

async function listAccounts(env, auth, url) {
  if (!canApprove(auth)) return json({ error: 'forbidden' }, 403);
  const filter = url.searchParams.get('filter') || 'pending';
  const where = {
    pending: "status = 'pending'",
    resets: "reset = 'requested'",
    active: "status = 'active'",
    all: '1',
  }[filter] || "status = 'pending'";
  const all = auth.r === 'owner' || (auth.h || []).includes('*');
  const stmt = all
    ? env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounts WHERE ${where} ORDER BY created_at DESC LIMIT 500`)
    : env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounts WHERE ${where} AND hosp IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 500`).bind(JSON.stringify(auth.h || []));
  const { results } = await stmt.all();
  return json({ ok: true, accounts: results.map(profile) });
}

/**
 * Body: { id, action, role?, hospitals? }
 * action: approve | reject | disable | enable | approve_reset | deny_reset | set_role | delete
 * Admins act only on plain user accounts of their own hospitals; roles are the owner's call.
 */
async function decide(request, env, auth) {
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
  const setStatus = (status, bump) => env.DB.prepare(
    `UPDATE accounts SET status = ?, decided_at = ?, decided_by = ?${bump ? ', sess = sess + 1' : ''} WHERE id = ?`
  ).bind(status, now, by, row.id);

  let role = row.role, hospitals = scopeOf(row);
  if (body.role !== undefined || body.hospitals !== undefined) {
    if (!isOwner) return json({ error: 'forbidden' }, 403);
    role = ACCOUNT_ROLES.includes(body.role) ? body.role : row.role;
    hospitals = Array.isArray(body.hospitals) ? body.hospitals.map(String).filter(h => h === '*' || HOSP_RE.test(h)).slice(0, 50) : hospitals;
    if (role !== 'user' && role !== 'owner' && !hospitals.length) hospitals = [row.hosp];
    stmts.push(env.DB.prepare('UPDATE accounts SET role = ?, hospitals = ? WHERE id = ?').bind(role, JSON.stringify(role === 'user' ? [] : hospitals), row.id));
  }

  switch (action) {
    case 'approve':
      if (row.status !== 'pending') return json({ error: 'not_pending' }, 409);
      stmts.push(setStatus('active', false));
      stmts.push(notifyOne(env, row.id, 'approved', 'account_approved', JSON.stringify({ by: auth.name || null, role }), now));
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
      stmts.push(notifyOne(env, row.id, 'reset', 'reset_approved', JSON.stringify({ by: auth.name || null }), now));
      break;
    case 'deny_reset':
      stmts.push(env.DB.prepare('UPDATE accounts SET reset = NULL, reset_at = NULL WHERE id = ?').bind(row.id));
      break;
    case 'set_role':
      if (!isOwner) return json({ error: 'forbidden' }, 403);
      if (role !== row.role) stmts.push(notifyOne(env, row.id, 'role', 'role_changed', JSON.stringify({ role, hospitals }), now));
      break;
    case 'delete':
      if (!isOwner) return json({ error: 'forbidden' }, 403);
      stmts.push(
        env.DB.prepare('DELETE FROM likes WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM notifications WHERE account_id = ?').bind(row.id),
        env.DB.prepare('UPDATE comments SET deleted = 1 WHERE account_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(row.id),
      );
      break;
    default:
      return json({ error: 'bad_action' }, 400);
  }
  // The request is handled: clear the matching notification for every approver.
  if (['approve', 'reject', 'delete'].includes(action)) stmts.push(env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('signup:' + row.id));
  if (['approve_reset', 'deny_reset', 'delete'].includes(action)) stmts.push(env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('reset:' + row.id));
  stmts.push(env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(now, by, `Account ${action}: ${row.username}${role !== row.role ? ' -> ' + role : ''}`));
  await env.DB.batch(stmts);
  const updated = await env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounts WHERE id = ?`).bind(row.id).first();
  return json({ ok: true, account: profile(updated) });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function listNotifications(env, auth, url) {
  const stmts = [];
  const since = Number(url.searchParams.get('since')) || 0;
  if (auth.a) {
    stmts.push(env.DB.prepare(
      `SELECT nid, type, data, ts, seen FROM notifications WHERE account_id = ?1 AND ts > ?2 ORDER BY ts DESC LIMIT 40`
    ).bind(auth.a, since));
    stmts.push(env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND seen = 0').bind(auth.a));
  }
  if (canApprove(auth)) {
    const all = auth.r === 'owner' || (auth.h || []).includes('*');
    const scope = all ? '' : ' AND hosp IN (SELECT value FROM json_each(?1))';
    stmts.push(env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM accounts WHERE status = 'pending'${scope}) AS accounts,
              (SELECT COUNT(*) FROM accounts WHERE reset = 'requested'${scope}) AS resets`
    ).bind(...(all ? [] : [JSON.stringify(auth.h || [])])));
  }
  if (auth.a) stmts.push(env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').bind(Date.now(), auth.a));
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  let i = 0;
  const items = auth.a ? res[i++].results.map(n => ({ ...n, data: JSON.parse(n.data) })) : [];
  const unread = auth.a ? res[i++].results[0].n : 0;
  const pending = canApprove(auth) ? res[i++].results[0] : null;
  return json({ ok: true, items, unread, pending, time: Date.now() });
}

async function markSeen(request, env, auth) {
  if (!auth.a) return json({ ok: true });
  const body = await readJson(request) || {};
  if (Array.isArray(body.nids) && body.nids.length) {
    await env.DB.prepare('UPDATE notifications SET seen = 1 WHERE account_id = ?1 AND nid IN (SELECT value FROM json_each(?2))')
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

async function thread(env, auth, url) {
  const card = cardTarget(url.searchParams.get('h'), url.searchParams.get('d'), url.searchParams.get('n'));
  if (!card) return json({ error: 'bad_request' }, 400);
  const [likesRes, commentsRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.name AS name, l.ts AS ts, l.account_id = ?2 AS mine FROM likes l JOIN accounts a ON a.id = l.account_id
        WHERE l.target = ?1 ORDER BY l.ts DESC LIMIT 300`
    ).bind(card.target, auth.a || ''),
    env.DB.prepare(
      `SELECT c.cid, c.account_id, c.anon, c.body, c.ts, a.name AS name
         FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.target = ?1 AND c.deleted = 0 ORDER BY c.cid LIMIT 300`
    ).bind(card.target),
  ]);
  const owner = auth.r === 'owner';
  const moderator = owner || (auth.r === 'admin' && hospInScope(auth, card.hosp));
  const comments = commentsRes.results.map(c => ({
    cid: c.cid,
    author: c.anon || c.name || '—',
    anon: !!c.anon,
    // Anonymous comments are anonymous to everybody except the owner (to deal with abuse).
    realName: owner && c.anon ? c.name : undefined,
    body: c.body,
    ts: c.ts,
    mine: !!auth.a && c.account_id === auth.a,
    canDelete: moderator || (!!auth.a && c.account_id === auth.a),
  }));
  return json({
    ok: true,
    likes: likesRes.results.map(l => ({ name: l.name, ts: l.ts, mine: !!l.mine })),
    comments,
    canReact: !!auth.a,
    myAnonTag: auth.a ? await anonTag(env, auth.a, card.target) : null,
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
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0`
  ).bind(card.target, gkey, type, card.hosp, card.date, card.name, extra.last, extra.text || null, now, card.key, actorId);
}

async function like(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request);
  const card = body && cardTarget(body.h, body.d, body.n);
  if (!card) return json({ error: 'bad_request' }, 400);
  if (await overLimit(env, 'like:' + auth.a, 120)) return json({ error: 'rate_limited' }, 429);
  const now = Date.now();
  if (body.on === false) {
    await env.DB.prepare('DELETE FROM likes WHERE target = ? AND account_id = ?').bind(card.target, auth.a).run();
  } else {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO likes (target, account_id, ts) VALUES (?, ?, ?)').bind(card.target, auth.a, now).run();
    if (ins.meta.changes) await notifyCardOwners(env, card, auth.a, 'like', { last: auth.name }, now).run();
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS n, EXISTS (SELECT 1 FROM likes WHERE target = ?1 AND account_id = ?2) AS mine FROM likes WHERE target = ?1')
    .bind(card.target, auth.a).first();
  return json({ ok: true, likes: row.n, mine: !!row.mine });
}

async function addComment(request, env, auth) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  const body = await readJson(request);
  const card = body && cardTarget(body.h, body.d, body.n);
  const text = plainText(body && body.body, 600);
  if (!card || !text) return json({ error: 'bad_request' }, 400);
  if (await overLimit(env, 'comment:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);
  const now = Date.now();
  const anon = body.anon ? await anonTag(env, auth.a, card.target) : null;
  const [ins] = await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (target, hosp, account_id, anon, body, ts) VALUES (?, ?, ?, ?, ?, ?) RETURNING cid')
      .bind(card.target, card.hosp, auth.a, anon, text, now),
    notifyCardOwners(env, card, auth.a, 'comment', { last: anon || auth.name, text: text.slice(0, 120) }, now),
  ]);
  return json({
    ok: true,
    comment: { cid: ins.results[0].cid, author: anon || auth.name, anon: !!anon, body: text, ts: now, mine: true, canDelete: true },
  });
}

async function deleteComment(request, env, auth) {
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT cid, hosp, account_id FROM comments WHERE cid = ? AND deleted = 0').bind(Number(body && body.cid) || 0).first();
  if (!row) return json({ error: 'not_found' }, 404);
  const allowed = (auth.a && row.account_id === auth.a) || auth.r === 'owner' || (auth.r === 'admin' && hospInScope(auth, row.hosp));
  if (!allowed) return json({ error: 'forbidden' }, 403);
  await env.DB.prepare('UPDATE comments SET deleted = 1 WHERE cid = ?').bind(row.cid).run();
  return json({ ok: true });
}

// A stable nickname per (account, card): readable within one conversation, unlinkable across cards.
const ANIMALS = ['الصقر', 'النمر', 'الذئب', 'الفهد', 'النسر', 'الأسد', 'الدلفين', 'الحوت', 'الثعلب', 'الغزال', 'البوم', 'الحصان',
  'الباز', 'الوشق', 'الشاهين', 'القط', 'الدب', 'الطاووس', 'اللقلق', 'الكركي', 'السنجاب', 'الفيل', 'القندس', 'الببغاء'];
const TRAITS = ['الذهبي', 'الفضي', 'الأزرق', 'الأخضر', 'الأحمر', 'الأبيض', 'الرمادي', 'البنفسجي', 'البرتقالي', 'الهادئ', 'الشجاع',
  'الحكيم', 'السريع', 'الخفي', 'اللامع', 'الصبور'];

async function anonTag(env, accountId, target) {
  const h = await hmac(env, `anon|${accountId}|${target}`);
  return `مجهول · ${ANIMALS[h[0] % ANIMALS.length]} ${TRAITS[h[1] % TRAITS.length]}`;
}
