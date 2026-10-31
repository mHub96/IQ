/**
 * Sign-in with the phone's fingerprint / face (passkeys, WebAuthn), migration 0021.
 *
 * A signed-in user turns it on for a device in their account panel: the device makes a key pair whose
 * private half never leaves it and is unlocked only by the owner's biometrics (user verification is
 * required), and the server keeps the public half (passkeys). Signing in, the device signs a fresh
 * challenge; the server checks the signature, the site (origin and rpId), the challenge and the
 * counter, then signs in as the password does (account status and device limit included).
 *
 * Challenges are stateless: a short-lived token signed with the session key carries the challenge,
 * what it is for and for whom, so nothing is stored per attempt.
 */

import { json, readJson, signToken, verifyToken, overLimit, plainText, b64, unb64 } from './lib.js';

const CHALLENGE_MS = 3 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,1400}$/;
const BLOB_RE = /^[A-Za-z0-9_-]{16,8000}$/;
const MAX_PER_ACCOUNT = 10;

const enc8 = new TextEncoder();
const dec8 = new TextDecoder();
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = str => unb64(String(str || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str || '').length + 3) % 4));
const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Routes under /api/passkeys. finishLogin signs a verified account in (accounts.js). Null when not matched. */
export function routePasskeys(path, method, request, env, auth, finishLogin, ip) {
  if (!/^\/api\/passkeys(\/|$)/.test(path)) return null;
  switch (`${method} ${path}`) {
    case 'POST /api/passkeys/login-options': return loginOptions(env, ip);
    case 'POST /api/passkeys/login': return login(request, env, finishLogin, ip);
  }
  if (!auth || !auth.a) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/passkeys': return list(env, auth);
    case 'POST /api/passkeys/register-options': return registerOptions(env, auth);
    case 'POST /api/passkeys/register': return register(request, env, auth);
    case 'POST /api/passkeys/remove': return remove(request, env, auth);
  }
  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------------
// The site a request comes from
// ---------------------------------------------------------------------------

/** The page's origin when it is one of the site's (ALLOWED_ORIGINS, or a local test server). */
function siteOrigin(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

/** Checks clientDataJSON and authenticatorData. Returns { rpId, flags, counter, data } or an error string. */
async function checkCeremony(env, type, challenge, clientDataB64, authDataB64) {
  let client;
  const clientBytes = unb64url(clientDataB64);
  try { client = JSON.parse(dec8.decode(clientBytes)); } catch { return 'bad_client_data'; }
  if (client.type !== type) return 'bad_type';
  if (client.challenge !== challenge) return 'bad_challenge';
  const origin = siteOrigin(env, String(client.origin || ''));
  if (!origin) return 'bad_origin';
  const rpId = new URL(origin).hostname;
  const data = unb64url(authDataB64);
  if (data.length < 37) return 'bad_auth_data';
  if (!sameBytes(data.slice(0, 32), await sha256(enc8.encode(rpId)))) return 'bad_rp';
  const flags = data[32];
  // User present and user verified (the fingerprint / face / device PIN): both required.
  if (!(flags & 0x01) || !(flags & 0x04)) return 'not_verified';
  const counter = ((data[33] << 24) >>> 0) + (data[34] << 16) + (data[35] << 8) + data[36];
  return { rpId, flags, counter, data, clientBytes };
}

// ---------------------------------------------------------------------------
// Minimal CBOR (the attestation object and its COSE public key)
// ---------------------------------------------------------------------------

function cbor(bytes) {
  let i = 0;
  const len = info => {
    if (info < 24) return info;
    if (info === 24) return bytes[i++];
    if (info === 25) { const v = (bytes[i] << 8) | bytes[i + 1]; i += 2; return v; }
    if (info === 26) { const v = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]; i += 4; return v; }
    throw new Error('cbor: length');
  };
  const item = () => {
    const b = bytes[i++], major = b >> 5, info = b & 31;
    if (major === 0) return len(info);
    if (major === 1) return -1 - len(info);
    if (major === 2) { const n = len(info); const v = bytes.slice(i, i + n); i += n; return v; }
    if (major === 3) { const n = len(info); const v = dec8.decode(bytes.slice(i, i + n)); i += n; return v; }
    if (major === 4) { const n = len(info); const a = []; for (let k = 0; k < n; k++) a.push(item()); return a; }
    if (major === 5) { const n = len(info); const m = new Map(); for (let k = 0; k < n; k++) { const key = item(); m.set(key, item()); } return m; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('cbor: type');
  };
  const value = item();
  return { value, end: i };
}

/** The credential's public key from authenticatorData (attested credential data) as a JWK + algorithm. */
function credentialKey(authData) {
  if (!(authData[32] & 0x40)) throw new Error('no attested credential');
  let p = 37 + 16;   // rpIdHash, flags, counter, AAGUID
  const idLen = (authData[p] << 8) | authData[p + 1];
  p += 2;
  const credId = authData.slice(p, p + idLen);
  p += idLen;
  const cose = cbor(authData.slice(p)).value;
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { credId, alg, jwk: { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)), ext: true } };
  }
  if (kty === 3 && alg === -257) {
    return { credId, alg, jwk: { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)), alg: 'RS256', ext: true } };
  }
  throw new Error('unsupported key');
}

/** ECDSA signatures come DER-encoded; WebCrypto wants r || s (32 bytes each). */
function derToRaw(der) {
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const part = () => {
    if (der[p++] !== 0x02) throw new Error('der');
    const n = der[p++];
    let v = der.slice(p, p + n);
    p += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64);
  raw.set(r, 0); raw.set(s, 32);
  return raw;
}

async function verifySignature(alg, jwk, signature, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Turning it on (signed in)
// ---------------------------------------------------------------------------

async function registerOptions(env, auth) {
  const row = await env.DB.prepare('SELECT id, username, name FROM accounts WHERE id = ?').bind(auth.a).first();
  if (!row) return json({ error: 'no_account' }, 404);
  const { results } = await env.DB.prepare('SELECT id FROM passkeys WHERE account_id = ?').bind(auth.a).all();
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = await signToken(env, { k: 'pk-reg', c: challenge, a: auth.a, e: Date.now() + CHALLENGE_MS });
  return json({
    ok: true, challenge, token,
    user: { id: b64url(enc8.encode(row.id)), name: row.username, displayName: row.name || row.username },
    exclude: results.map(r => r.id),
  });
}

async function register(request, env, auth) {
  const b = await readJson(request) || {};
  const t = await verifyToken(env, b.token);
  if (!t || t.k !== 'pk-reg' || t.a !== auth.a || !(t.e > Date.now())) return json({ error: 'expired' }, 400);
  if (!BLOB_RE.test(String(b.attestationObject || '')) || !BLOB_RE.test(String(b.clientDataJSON || ''))) return json({ error: 'bad_request' }, 400);
  let att;
  try { att = cbor(unb64url(b.attestationObject)).value; } catch { return json({ error: 'bad_attestation' }, 400); }
  const authData = att instanceof Map ? att.get('authData') : null;
  if (!(authData instanceof Uint8Array)) return json({ error: 'bad_attestation' }, 400);
  const c = await checkCeremony(env, 'webauthn.create', t.c, b.clientDataJSON, b64url(authData));
  if (typeof c === 'string') return json({ error: c }, 400);
  let key;
  try { key = credentialKey(c.data); } catch { return json({ error: 'unsupported_key' }, 400); }
  const id = b64url(key.credId);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?').bind(auth.a).first();
  if (count && count.n >= MAX_PER_ACCOUNT) return json({ error: 'too_many' }, 409);
  await env.DB.prepare(
    `INSERT INTO passkeys (id, account_id, public_key, alg, rp_id, sign_count, label, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, public_key = excluded.public_key, alg = excluded.alg,
       rp_id = excluded.rp_id, sign_count = excluded.sign_count, label = excluded.label`
  ).bind(id, auth.a, JSON.stringify(key.jwk), key.alg, c.rpId, c.counter, plainText(b.label, 80) || 'جهاز', Date.now()).run();
  return json({ ok: true, id });
}

async function list(env, auth) {
  const { results } = await env.DB.prepare('SELECT id, label, rp_id, created_at, last_used FROM passkeys WHERE account_id = ? ORDER BY created_at DESC').bind(auth.a).all();
  return json({ ok: true, passkeys: results.map(r => ({ id: r.id, label: r.label, site: r.rp_id, at: r.created_at, used: r.last_used })) });
}

async function remove(request, env, auth) {
  const b = await readJson(request) || {};
  await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND account_id = ?').bind(String(b.id || ''), auth.a).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

async function loginOptions(env, ip) {
  if (await overLimit(env, 'pkopt:' + ip, 60)) return json({ error: 'rate_limited' }, 429);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = await signToken(env, { k: 'pk-login', c: challenge, e: Date.now() + CHALLENGE_MS });
  return json({ ok: true, challenge, token });
}

async function login(request, env, finishLogin, ip) {
  const b = await readJson(request) || {};
  if (await overLimit(env, 'pklogin:' + ip, 30)) return json({ success: false, error: 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.' }, 429);
  const t = await verifyToken(env, b.token);
  if (!t || t.k !== 'pk-login' || !(t.e > Date.now())) return json({ success: false, error: 'انتهت مهلة المحاولة. حاول مجدداً.' }, 400);
  const id = String(b.id || '');
  if (!ID_RE.test(id) || !BLOB_RE.test(String(b.clientDataJSON || '')) || !BLOB_RE.test(String(b.authenticatorData || '')) || !BLOB_RE.test(String(b.signature || ''))) {
    return json({ success: false, error: 'bad_request' }, 400);
  }
  const pk = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(id).first();
  if (!pk) return json({ success: false, status: 'unknown_passkey', error: 'هذه البصمة غير مسجلة على أي حساب. سجّل الدخول بكلمة المرور ثم فعّل الدخول بالبصمة من حسابك.' });
  const c = await checkCeremony(env, 'webauthn.get', t.c, b.clientDataJSON, b.authenticatorData);
  if (typeof c === 'string') return json({ success: false, error: 'تعذر التحقق من البصمة (' + c + ').' }, 400);
  if (c.rpId !== pk.rp_id) return json({ success: false, error: 'تعذر التحقق من البصمة (bad_rp).' }, 400);
  const signed = new Uint8Array(c.data.length + 32);
  signed.set(c.data, 0);
  signed.set(await sha256(c.clientBytes), c.data.length);
  let ok = false;
  try { ok = await verifySignature(pk.alg, JSON.parse(pk.public_key), unb64url(b.signature), signed); } catch { ok = false; }
  if (!ok) return json({ success: false, error: 'تعذر التحقق من البصمة.' }, 400);
  // A counter that goes back means a copied key: refuse it.
  if (c.counter > 0 && pk.sign_count > 0 && c.counter <= pk.sign_count) return json({ success: false, error: 'تعذر التحقق من البصمة (counter).' }, 400);
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(pk.account_id).first();
  if (!row) return json({ success: false, error: 'الحساب غير موجود.' });
  await env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?').bind(c.counter, Date.now(), id).run();
  return finishLogin(env, row, b);
}
