/**
 * Hospital Hub API — Cloudflare Worker backed by D1.
 *
 * Design notes
 * - The free plan allows 10 ms CPU per request, so the Worker never parses the
 *   database: reads are assembled by SQLite (json_group_array) and returned as-is,
 *   and bulk writes are a handful of set-based statements over json_each().
 * - Every row has a version `v`. Writers send the version they started from (`bv`);
 *   a write only lands if the row is still at that version, otherwise the client
 *   gets a conflict with the current row and merges.
 * - Passwords never leave the Worker except to the owner, and are stored encrypted.
 * - Personal accounts, notifications and likes / comments live in accounts.js.
 */

import { DAY, json, signToken, verifyToken, encrypt, decrypt, bucketOf, neutralize } from './lib.js';
import { routeAccounts, resolveAccountAuth, mirrorResident } from './accounts.js';
import { routeDuties } from './duties.js';
import { routeExchange, approvalHospitals } from './exchange.js';
import { routeAA, isOfficer, AA_ROLES } from './aa.js';
import { nameKey } from './names.js';
import { dutyDayNow } from './profile.js';

const VISIT_COOLDOWN_MS = 60 * 1000;

const ROLES = ['user', 'anaesthesia', 'admin', 'owner'];
// Roles a login token may carry: the shared-password roles plus the personal-account-only roles
// (rotators, and the officers of a hospital's Administrative Affairs division).
const TOKEN_ROLES = [...ROLES, 'rotator', ...AA_ROLES];
const PAGE_ROWS = 1500;
const HISTORY_KEEP_DAYS = 120;
const LOGIN_FAIL_LIMIT = 20;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      const res = await route(request, env, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      console.error('Unhandled error', err && err.stack || err);
      return json({ error: 'server_error', message: String(err && err.message || err) }, 500, cors);
    }
  },

  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM history WHERE ts < ?').bind(now - HISTORY_KEEP_DAYS * DAY),
      env.DB.prepare('DELETE FROM audit WHERE ts < ?').bind(now - 365 * DAY),
      env.DB.prepare('DELETE FROM login_fail WHERE bucket < ?').bind(bucketOf(now) - 6),
    ]);
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '' || path === '/api' || path === '/api/health') {
    return json({ ok: true, service: 'hosp-hub-api', time: Date.now() });
  }
  if (path === '/api/login' && method === 'POST') return login(request, env);
  // Public: whether the sign-in panel offers the shared passwords.
  if (path === '/api/auth-config' && method === 'GET') return json({ sharedPasswords: !(await sharedPasswordsOff(env)) });

  const auth = await authenticate(request, env);

  if (path === '/api/session' && method === 'GET') {
    return auth ? json({ ok: true, role: auth.r, adminHospitals: auth.h, exp: auth.e, account: auth.a || null }) : json({ error: 'unauthorized' }, 401);
  }
  if (path === '/api/db' && method === 'GET') return readRecords(env, auth, url, false);
  const aaRoute = await routeAA(path, method, request, env, auth, url);
  if (aaRoute) return aaRoute;
  const exchangeRoute = await routeExchange(path, method, request, env, auth, url, ctx);
  if (exchangeRoute) return exchangeRoute;
  const dutiesRoute = await routeDuties(path, method, request, env, auth, url, ctx);
  if (dutiesRoute) return dutiesRoute;
  const accountRoute = await routeAccounts(path, method, request, env, auth, url, ctx);
  if (accountRoute) return accountRoute;

  if (path === '/api/er' && method === 'GET') {
    if (!canUseEr(auth)) return json({ error: 'forbidden' }, 403);
    return readRecords(env, auth, url, true);
  }

  if (!auth) return json({ error: 'unauthorized' }, 401);

  if (path === '/api/sync' && method === 'POST') return sync(request, env, auth);
  if (path === '/api/visit' && method === 'POST') return visit(request, env, auth, request.headers.get('CF-Connecting-IP') || 'unknown');
  if (path === '/api/secrets' && method === 'GET') return getSecrets(env, auth);
  if (path === '/api/secrets' && method === 'PUT') return putSecrets(request, env, auth);
  if (path === '/api/history' && method === 'GET') return getHistory(env, auth, url);
  if (path === '/api/revoke-sessions' && method === 'POST') return revokeSessions(env, auth);
  if (path === '/api/shared-passwords' && method === 'POST') return setSharedPasswords(request, env, auth);

  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function login(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const bucket = bucketOf(now);

  const fails = await env.DB.prepare('SELECT COALESCE(SUM(n),0) AS n FROM login_fail WHERE ip = ? AND bucket >= ?')
    .bind(ip, bucket - 1).first();
  if (fails && fails.n >= LOGIN_FAIL_LIMIT) {
    return json({ success: false, error: 'محاولات كثيرة خاطئة. يرجى الانتظار 10 دقائق ثم المحاولة مجدداً.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'bad_request' }, 400); }
  const pwd = String(body.password || '').trim();
  if (!pwd) return json({ success: false, error: 'الرجاء إدخال كلمة المرور' });

  const result = await matchPassword(env, pwd);
  if (!result) {
    await env.DB.prepare('INSERT INTO login_fail (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1')
      .bind(ip, bucket).run();
    return json({ success: false, error: 'كلمة المرور غير صحيحة' });
  }
  // Shared passwords switched off by the owner: only the owner's password still opens (the owner's way in
  // if their personal account is ever unavailable). Same answer as a wrong password, so nothing is revealed.
  if (result.role !== 'owner' && await sharedPasswordsOff(env)) {
    await env.DB.prepare('INSERT INTO login_fail (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1')
      .bind(ip, bucket).run();
    return json({ success: false, error: 'كلمة المرور غير صحيحة' });
  }

  // The owner may sign in "as" a lower role (used by the role picker on the login page).
  let role = result.role;
  let hospitals = result.adminHospitals;
  const hint = String(body.roleHint || '').toLowerCase();
  if (role === 'owner' && ROLES.includes(hint) && !(await sharedPasswordsOff(env))) {
    role = hint;
    hospitals = ['*'];
  }

  const ttl = body.remember === false ? DAY : 7 * DAY;
  const pv = await sessionGeneration(env);
  const payload = { r: role, h: hospitals, e: now + ttl, g: pv };
  const token = await signToken(env, payload);
  return json({ success: true, role, adminHospitals: hospitals, token, exp: payload.e });
}

/** Same precedence as the original client-side verifyPassword: global first, then per-hospital. */
async function matchPassword(env, pwd) {
  const { results } = await env.DB.prepare('SELECT scope, role, enc FROM secrets').all();
  const byScope = {};
  for (const row of results) {
    const plain = await decrypt(env, row.enc).catch(() => null);
    if (plain === null) continue;
    (byScope[row.scope] ||= {})[row.role] = plain;
  }
  const g = byScope.global || {};
  if (g.owner && pwd === g.owner) return { role: 'owner', adminHospitals: ['*'] };
  if (g.admin && pwd === g.admin) return { role: 'admin', adminHospitals: ['*'] };
  if (g.anaesthesia && pwd === g.anaesthesia) return { role: 'anaesthesia', adminHospitals: ['*'] };
  if (g.user && pwd === g.user) return { role: 'user', adminHospitals: [] };

  const owner = [], admin = [], anaesthesia = [], user = [];
  for (const [scope, p] of Object.entries(byScope)) {
    if (scope === 'global') continue;
    if (p.owner && pwd === p.owner) owner.push(scope);
    if (p.admin && pwd === p.admin) admin.push(scope);
    if (p.anaesthesia && pwd === p.anaesthesia) anaesthesia.push(scope);
    if (p.user && pwd === p.user) user.push(scope);
  }
  if (owner.length) return { role: 'owner', adminHospitals: ['*'] };
  if (admin.length) return { role: 'admin', adminHospitals: admin };
  if (anaesthesia.length) return { role: 'anaesthesia', adminHospitals: anaesthesia };
  // A hospital's own user password: that hospital is the user's (duty exchanges there only).
  if (user.length) return { role: 'user', adminHospitals: user };
  return null;
}

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = await verifyToken(env, m[1]);
  if (!payload || !TOKEN_ROLES.includes(payload.r) || payload.e < Date.now()) return null;
  // Personal accounts have their own session counter (password change / ban signs them out).
  if (payload.a) return resolveAccountAuth(env, payload);
  // Shared-password sessions: the session counter, and (switched off) only the owner's stay signed in.
  const { results } = await env.DB.prepare("SELECT k, v FROM kv WHERE k IN ('session_gen', 'shared_pw_off')").all();
  const kv = Object.fromEntries((results || []).map(r => [r.k, r.v]));
  if (payload.g !== (kv.session_gen ? Number(kv.session_gen) : 1)) return null;
  if (kv.shared_pw_off === '1' && payload.r !== 'owner') return null;
  return payload;
}

async function sessionGeneration(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'session_gen'").first();
  return row ? Number(row.v) : 1;
}

async function sharedPasswordsOff(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'shared_pw_off'").first();
  return !!row && row.v === '1';
}

/** Owner: switch signing in with the shared passwords on or off. Body: { active: boolean } */
async function setSharedPasswords(request, env, auth) {
  if (!isOwner(auth)) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const active = body.active !== false;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('shared_pw_off', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(active ? '0' : '1'),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)').bind(Date.now(), auth.r, active ? 'Shared passwords on' : 'Shared passwords off', 1),
  ]);
  return json({ ok: true, sharedPasswords: active });
}

async function revokeSessions(env, auth) {
  if (!isOwner(auth)) return json({ error: 'forbidden' }, 403);
  await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('session_gen', '2') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1").run();
  return json({ ok: true });
}

const isOwner = a => a && a.r === 'owner';
const inScope = (a, hosp) => a.h && (a.h.includes('*') || (hosp && a.h.includes(hosp)));
const canUseEr = a => a && (isOwner(a) || a.r === 'admin');
/** The doctor's own hospital: a personal account's hospital, or one the session is scoped to. */
const ownHospital = (a, hosp) => !!hosp && ((a.a && a.hosp === hosp) || inScope(a, hosp));

/** Server-side copy of the permission rules the pages already apply in the UI. */
function allowed(a, op) {
  if (isOwner(a)) return true;
  const isNew = !op.bv;
  switch (op.c) {
    case 'sched':
      // The hospital's doctors exchange duties, in their own hospital only (the hospital is the id's
      // prefix, not the client's word). Rotators only view and comment; division officers have their
      // own roster (aa.js).
      return ['user', 'anaesthesia', 'admin'].includes(a.r) && ownHospital(a, String(op.id || '').split(':')[0]);
    case 'icu':
      return a.r === 'anaesthesia' && inScope(a, op.h);
    case 'hospital':
      return a.r === 'admin' && !isNew && !op.del && inScope(a, op.id);
    case 'resident':
    case 'meta':
      return a.r === 'admin';
    case 'er':
    case 'er_conflict':
      return a.r === 'admin';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readRecords(env, auth, url, er) {
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  // Guests get the roster structure without phone numbers; so do division officers, who only use
  // their division's own data.
  const full = auth && !isOfficer(auth) ? 1 : 0;
  const collFilter = er ? "coll IN ('er')" : "coll NOT IN ('er', 'er_conflict')";
  const since = Number(url.searchParams.get('since'));
  if (since > 0) return readChanges(env, auth, full, collFilter, since);
  const row = await env.DB.prepare(
    `SELECT json_group_array(json_array(coll, id, hosp, ord, v, json(
              CASE WHEN ?2 = 0 AND coll = 'resident' THEN json_remove(data, '$.phone')
                   WHEN ?2 = 0 AND coll = 'hospital' THEN json_remove(data, '$.names')
                   ELSE data END))) AS rows,
            MAX(rid) AS last, COUNT(*) AS n
       FROM (SELECT rowid AS rid, * FROM records WHERE rowid > ?1 AND ${collFilter} ORDER BY rowid LIMIT ${PAGE_ROWS})`
  ).bind(after, full).first();
  const n = row ? row.n : 0;
  const body = `{"rows":${n ? row.rows : '[]'},"last":${n ? row.last : after},"more":${n === PAGE_ROWS},"full":${!!full},"role":${JSON.stringify(auth ? auth.r : 'guest')},"time":${Date.now()}}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * Incremental read: rows changed at or after `since` plus rows deleted since then.
 * Uses the updated_at / history.ts indexes, so a page view reads only what changed.
 */
async function readChanges(env, auth, full, collFilter, since) {
  if (Date.now() - since > (HISTORY_KEEP_DAYS - 7) * DAY) return json({ reset: true });
  const [changed, deleted] = await env.DB.batch([
    env.DB.prepare(
      `SELECT json_group_array(json_array(coll, id, hosp, ord, v, json(
                CASE WHEN ?2 = 0 AND coll = 'resident' THEN json_remove(data, '$.phone')
                     WHEN ?2 = 0 AND coll = 'hospital' THEN json_remove(data, '$.names')
                     ELSE data END))) AS rows, COUNT(*) AS n
         FROM (SELECT * FROM records WHERE updated_at >= ?1 AND ${collFilter} LIMIT 2001)`
    ).bind(since, full),
    env.DB.prepare(
      `SELECT json_group_array(json_array(coll, id)) AS rows, COUNT(*) AS n
         FROM (SELECT DISTINCT coll, id FROM history WHERE deleted = 1 AND ts >= ?1 AND ${collFilter} LIMIT 2001)`
    ).bind(since),
  ]);
  const c = changed.results[0], d = deleted.results[0];
  if (c.n > 2000 || d.n > 2000) return json({ reset: true });
  const body = `{"changed":${c.n ? c.rows : '[]'},"deleted":${d.n ? d.rows : '[]'},"full":${!!full},"role":${JSON.stringify(auth ? auth.r : 'guest')},"time":${Date.now()}}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function getHistory(env, auth, url) {
  if (!isOwner(auth)) return json({ error: 'forbidden' }, 403);
  const coll = url.searchParams.get('coll');
  const id = url.searchParams.get('id');
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
  const stmt = coll && id
    ? env.DB.prepare('SELECT hid, coll, id, hosp, v, data, deleted, ts, by, msg FROM history WHERE coll = ? AND id = ? ORDER BY hid DESC LIMIT ?').bind(coll, id, limit)
    : env.DB.prepare('SELECT aid, ts, role, msg, n FROM audit ORDER BY aid DESC LIMIT ?').bind(limit);
  const { results } = await stmt.all();
  return json({ results });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Body: { msg, ops: [ { c, id, h, o, bv, d } | { c, id, bv, del: 1 } | { c, id, o, ordOnly: 1 } ] }
 * Response: { applied: [[i, v]], conflicts: [[i, v|null, data|null]], rejected: [i] }
 */
async function sync(request, env, auth) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length === 0) return json({ applied: [], conflicts: [], rejected: [] });
  if (ops.length > 2000) return json({ error: 'too_many_ops' }, 413);

  const now = Date.now();
  const wid = crypto.randomUUID();
  const by = auth.a ? `${auth.r}:${auth.name}` : auth.r;
  const msg = String(body.msg || '').slice(0, 300);

  // Hospitals where residents' exchanges need approval: their roster writes go through /api/exchange.
  const approval = ['user', 'anaesthesia'].includes(auth.r) && ops.some(op => op && op.c === 'sched')
    ? new Set(await approvalHospitals(env)) : null;
  const puts = [], dels = [], ords = [], rejected = [], checks = [];
  ops.forEach((op, i) => {
    if (!op || typeof op.c !== 'string' || typeof op.id !== 'string' || !op.id) { rejected.push(i); return; }
    if (!allowed(auth, op)) { rejected.push(i); return; }
    if (approval && op.c === 'sched' && approval.has(String(op.id).split(':')[0])) { rejected.push(i); return; }
    const bv = Number(op.bv) || 0;
    if (op.ordOnly) {
      ords.push({ c: op.c, id: op.id, o: Number(op.o) || 0 });
    } else if (op.del) {
      dels.push({ i, c: op.c, id: op.id, bv });
      checks.push({ i, c: op.c, id: op.id, del: 1 });
    } else {
      if (op.d === undefined) { rejected.push(i); return; }
      const text = JSON.stringify(op.d);
      puts.push({ i, c: op.c, id: op.id, h: op.h ?? null, o: Number(op.o) || 0, bv, dt: RAW_COLLS.has(op.c) ? text : neutralize(text) });
      checks.push({ i, c: op.c, id: op.id, del: 0 });
    }
  });

  const stmts = [];
  const prev = [...puts.map(p => ({ c: p.c, id: p.id, bv: p.bv, del: 0 })), ...dels.map(p => ({ c: p.c, id: p.id, bv: p.bv, del: 1 }))];
  if (prev.length) {
    stmts.push(env.DB.prepare(
      `INSERT INTO history (coll, id, hosp, v, data, deleted, ts, by, msg)
       SELECT r.coll, r.id, r.hosp, r.v, r.data, json_extract(j.value, '$.del'), ?2, ?3, ?4
         FROM json_each(?1) j JOIN records r
           ON r.coll = json_extract(j.value, '$.c') AND r.id = json_extract(j.value, '$.id') AND r.v = json_extract(j.value, '$.bv')`
    ).bind(JSON.stringify(prev), now, by, msg));
  }
  if (puts.length) {
    stmts.push(env.DB.prepare(
      `INSERT INTO records (coll, id, hosp, ord, v, data, updated_at, updated_by, wid)
       SELECT json_extract(j.value, '$.c'), json_extract(j.value, '$.id'), json_extract(j.value, '$.h'),
              json_extract(j.value, '$.o'), json_extract(j.value, '$.bv') + 1, json(json_extract(j.value, '$.dt')), ?2, ?3, ?4
         FROM json_each(?1) j WHERE true
       ON CONFLICT (coll, id) DO UPDATE SET
         hosp = excluded.hosp, ord = excluded.ord, v = excluded.v, data = excluded.data,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by, wid = excluded.wid
       WHERE records.v = excluded.v - 1`
    ).bind(JSON.stringify(puts.map(p => ({ c: p.c, id: p.id, h: p.h, o: p.o, bv: p.bv, dt: p.dt }))), now, by, wid));
  }
  if (dels.length) {
    stmts.push(env.DB.prepare(
      `DELETE FROM records WHERE (coll, id, v) IN (
         SELECT json_extract(value, '$.c'), json_extract(value, '$.id'), json_extract(value, '$.bv') FROM json_each(?1))`
    ).bind(JSON.stringify(dels.map(p => ({ c: p.c, id: p.id, bv: p.bv })))));
    const goneHospitals = dels.filter(p => p.c === 'hospital').map(p => p.id);
    if (goneHospitals.length && isOwner(auth)) {
      stmts.push(env.DB.prepare('DELETE FROM secrets WHERE scope IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(goneHospitals)));
    }
  }
  if (ords.length) {
    stmts.push(env.DB.prepare(
      `UPDATE records SET ord = (
         SELECT json_extract(j.value, '$.o') FROM json_each(?1) j
          WHERE json_extract(j.value, '$.c') = records.coll AND json_extract(j.value, '$.id') = records.id)
       WHERE (coll, id) IN (SELECT json_extract(value, '$.c'), json_extract(value, '$.id') FROM json_each(?1))`
    ).bind(JSON.stringify(ords)));
  }
  stmts.push(env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)').bind(now, by, msg, ops.length - rejected.length));

  const checkIndex = stmts.length;
  if (checks.length) {
    stmts.push(env.DB.prepare(
      `SELECT json_extract(j.value, '$.i') AS i, json_extract(j.value, '$.del') AS del, r.v AS v, r.wid AS wid, r.data AS data
         FROM json_each(?1) j LEFT JOIN records r
           ON r.coll = json_extract(j.value, '$.c') AND r.id = json_extract(j.value, '$.id')`
    ).bind(JSON.stringify(checks)));
  }

  // Resident records as they were, to carry a change of identity to the account and the roster.
  const residentPuts = puts.filter(p => p.c === 'resident');
  const residentsBefore = new Map();
  if (residentPuts.length) {
    const { results: rows } = await env.DB.prepare("SELECT id, data FROM records WHERE coll = 'resident' AND id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(residentPuts.map(p => p.id))).all();
    for (const r of rows) { try { residentsBefore.set(r.id, JSON.parse(r.data)); } catch {} }
  }

  const results = await env.DB.batch(stmts);
  const applied = [], conflicts = [];
  if (checks.length) {
    for (const row of results[checkIndex].results) {
      if (row.del) {
        if (row.v === null) applied.push([row.i, 0]);
        else conflicts.push([row.i, row.v, row.data]);
      } else if (row.wid === wid) {
        applied.push([row.i, row.v]);
      } else {
        conflicts.push([row.i, row.v, row.data]);
      }
    }
  }
  for (const p of residentPuts) {
    const before = residentsBefore.get(p.id);
    if (!before || !applied.some(([i]) => i === p.i)) continue;
    let after;
    try { after = JSON.parse(p.dt); } catch { continue; }
    if (before.name !== after.name || before.phone !== after.phone || JSON.stringify(before.hospitals) !== JSON.stringify(after.hospitals)) {
      await mirrorResident(env, p.id, before, after, by).catch(err => console.warn('mirrorResident failed', err && err.message));
    }
  }
  // `data` in conflicts is raw JSON text; the client parses it.
  return json({ applied, conflicts, rejected, ordered: ords.length });
}

// ER scheduler data is admin-only and may legitimately contain markup (print templates).
const RAW_COLLS = new Set(['er', 'er_conflict']);


/** Contact-tap counter: an atomic increment so concurrent taps never overwrite each other. */
/**
 * Contact-tap counter. One visit per person per resident per minute: Call and WhatsApp count as the
 * same visit, and refreshing or re-tapping does not add more. "Person" is the account (or the device /
 * connection for shared-password sessions), so the cooldown holds whatever happens on the phone.
 */
async function visit(request, env, auth, ip) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = String(body.id || '');
  if (!id) return json({ error: 'bad_request' }, 400);
  const now = Date.now();
  const entry = await env.DB.prepare("SELECT hosp, json_extract(data, '$.name') AS name, json_extract(data, '$.VisitCount') AS count, v FROM records WHERE coll = 'sched' AND id = ?")
    .bind(id).first();
  if (!entry) return json({ error: 'not_found' }, 404);
  const who = auth.a ? 'a:' + auth.a : auth.dv ? 'd:' + auth.dv : 'ip:' + ip + ':' + auth.r;
  const key = `${who}|${entry.hosp}|${nameKey(entry.name)}|${dutyDayNow(now)}`;
  // Claims the slot only when the last counted visit is over a minute old (atomic).
  const claimed = await env.DB.prepare(
    `INSERT INTO visit_cooldown (k, ts) VALUES (?1, ?2)
     ON CONFLICT (k) DO UPDATE SET ts = excluded.ts WHERE visit_cooldown.ts <= ?3
     RETURNING ts`
  ).bind(key, now, now - VISIT_COOLDOWN_MS).first();
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM visit_cooldown WHERE ts < ?').bind(now - DAY).run();
  if (!claimed) {
    const last = await env.DB.prepare('SELECT ts FROM visit_cooldown WHERE k = ?').bind(key).first();
    return json({ ok: true, cooldown: true, count: entry.count || 0, v: entry.v, retryIn: Math.max(0, VISIT_COOLDOWN_MS - (now - (last ? last.ts : now))) });
  }
  const row = await env.DB.prepare(
    `UPDATE records SET data = json_set(data, '$.VisitCount', COALESCE(json_extract(data, '$.VisitCount'), 0) + 1),
            v = v + 1, updated_at = ?2, updated_by = ?3, wid = NULL
      WHERE coll = 'sched' AND id = ?1
      RETURNING v, json_extract(data, '$.VisitCount') AS count`
  ).bind(id, Date.now(), auth.r).first();
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ ok: true, v: row.v, count: row.count });
}

// ---------------------------------------------------------------------------
// Passwords (owner only)
// ---------------------------------------------------------------------------

async function getSecrets(env, auth) {
  if (!isOwner(auth)) return json({ error: 'forbidden' }, 403);
  const { results } = await env.DB.prepare('SELECT scope, role, enc FROM secrets').all();
  const out = {};
  for (const row of results) {
    const plain = await decrypt(env, row.enc).catch(() => null);
    if (plain !== null) (out[row.scope] ||= {})[row.role] = plain;
  }
  return json({ secrets: out });
}

/** Body: { secrets: { <scope>: { <role>: <password> | null } } }  — null removes a password. */
async function putSecrets(request, env, auth) {
  if (!isOwner(auth)) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const stmts = [];
  for (const [scope, roles] of Object.entries(body.secrets || {})) {
    for (const [role, pwd] of Object.entries(roles || {})) {
      if (!ROLES.includes(role)) continue;
      if (pwd === null || pwd === '') {
        stmts.push(env.DB.prepare('DELETE FROM secrets WHERE scope = ? AND role = ?').bind(scope, role));
      } else {
        const enc = await encrypt(env, String(pwd).trim());
        stmts.push(env.DB.prepare('INSERT INTO secrets (scope, role, enc) VALUES (?, ?, ?) ON CONFLICT(scope, role) DO UPDATE SET enc = excluded.enc').bind(scope, role, enc));
      }
    }
  }
  if (stmts.length > 45) return json({ error: 'too_many_changes' }, 413);
  if (stmts.length) {
    stmts.push(env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)').bind(Date.now(), auth.r, 'Password change', stmts.length));
    await env.DB.batch(stmts);
  }
  return json({ ok: true, changed: stmts.length ? stmts.length - 1 : 0 });
}

function corsHeaders(env, origin) {
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowedOrigins.includes(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    // Cloudflare Pages preview deployments of an allowed site (https://<hash>.<project>.pages.dev).
    || allowedOrigins.some(o => o.endsWith('.pages.dev') && origin.startsWith('https://') && origin.endsWith('.' + o.replace('https://', '')));
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowedOrigins[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
