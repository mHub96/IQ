// Shared crypto and HTTP helpers.

export const DAY = 24 * 60 * 60 * 1000;

const enc8 = new TextEncoder();
const dec8 = new TextDecoder();

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = str => unb64(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));

let hmacKeyPromise = null;
function hmacKey(env) {
  return hmacKeyPromise ||= crypto.subtle.importKey('raw', enc8.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmac(env, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), enc8.encode(text)));
}

export async function signToken(env, payload) {
  const body = b64url(enc8.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(env, body))}`;
}

export async function verifyToken(env, token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(sig), enc8.encode(body));
    return ok ? JSON.parse(dec8.decode(unb64url(body))) : null;
  } catch {
    return null;
  }
}

export async function sha256b64(text) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc8.encode(text))));
}

let aesKeyPromise = null;
function aesKey(env) {
  return aesKeyPromise ||= crypto.subtle.importKey('raw', unb64(env.PW_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc8.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

export async function decrypt(env, blob) {
  const raw = unb64(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(env), raw.slice(12));
  return dec8.decode(pt);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bucketOf(ms) {
  return Math.floor(ms / (10 * 60 * 1000));
}

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/**
 * Fixed 10-minute window limiter. Returns true when the caller is over `limit`.
 * Counts the attempt in the same statement, so one round trip per check.
 */
export async function overLimit(env, key, limit) {
  const bucket = bucketOf(Date.now());
  const row = await env.DB.prepare(
    `INSERT INTO rate_limit (k, bucket, n) VALUES (?1, ?2, 1)
     ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1 RETURNING n`
  ).bind(key, bucket).first();
  if (Math.random() < 0.01) {
    await env.DB.prepare('DELETE FROM rate_limit WHERE bucket < ?').bind(bucket - 6).run();
  }
  return row && row.n > limit;
}

/** Strips characters that could start markup; comment text is also escaped when rendered. */
export function plainText(s, max) {
  return String(s || '').replace(/[<>`]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
