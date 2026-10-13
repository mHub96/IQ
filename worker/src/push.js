/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
 * implemented with WebCrypto only. Secrets: VAPID_PRIVATE (base64url `d`), var VAPID_PUBLIC
 * (base64url uncompressed point), var VAPID_SUBJECT (mailto: or https: contact).
 */

const enc = new TextEncoder();

export const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = str => {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * Encrypts `plaintext` for one subscription (RFC 8291). `ephemeral` and `salt` are only passed
 * by tests (to reproduce the RFC example); normally they are random.
 */
export async function encryptPayload(plaintext, p256dh, authSecret, { ephemeral, salt } = {}) {
  const uaPublic = typeof p256dh === 'string' ? unb64u(p256dh) : p256dh;
  const auth = typeof authSecret === 'string' ? unb64u(authSecret) : authSecret;
  const asKeys = ephemeral || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(auth, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const header = new Uint8Array(21);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ct);
}

let vapidKey = null;
const jwtCache = new Map(); // audience -> { jwt, exp }

async function vapidJwt(env, audience) {
  const now = Math.floor(Date.now() / 1000);
  const cached = jwtCache.get(audience);
  if (cached && cached.exp - now > 3600) return cached.jwt;
  if (!vapidKey) {
    const pub = unb64u(env.VAPID_PUBLIC);
    vapidKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const exp = now + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT || 'https://hosp-hub-beta.mrjuniversity.workers.dev' })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, enc.encode(`${head}.${body}`)));
  const jwt = `${head}.${body}.${b64u(sig)}`;
  jwtCache.set(audience, { jwt, exp });
  return jwt;
}

// Only real browser push services are contacted (the Worker never fetches arbitrary URLs).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
export const isPushEndpoint = url => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch { return false; }
};

/**
 * Sends one message. Returns the push service status (201 = accepted, 404/410 = subscription gone).
 * `topic` lets the push service replace an undelivered older message with the same topic.
 */
export async function sendPush(env, sub, message, { ttl = 86400, topic, urgency = 'normal' } = {}) {
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC || !isPushEndpoint(sub.endpoint)) return 0;
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  const audience = new URL(sub.endpoint).origin;
  const headers = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: `vapid t=${await vapidJwt(env, audience)}, k=${env.VAPID_PUBLIC}`,
  };
  if (topic) headers.Topic = topic;
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return res.status;
}

/** Push-service topic: max 32 URL-safe characters. */
export async function topicFor(key) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(key)))).slice(0, 32);
}
