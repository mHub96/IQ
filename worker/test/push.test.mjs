// Web Push payload encryption: RFC 8291 example vector + a decrypt round trip.
// Run: node --test worker/test/push.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, b64u, unb64u, isPushEndpoint } from '../src/push.js';

const subtle = crypto.subtle;

async function importPair(pubB64u, privB64u) {
  const pub = unb64u(pubB64u);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privB64u, ext: true };
  const privateKey = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// Receiver side (what the browser does), used to prove the round trip.
async function decrypt(body, uaPair, uaPublic, auth) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPair.privateKey, 256));
  const te = new TextEncoder();
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(pt[pt.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(pt.slice(0, -1));
}

// RFC 8291, section 5.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('matches the RFC 8291 example byte for byte', async () => {
  const ephemeral = await importPair(RFC.asPublic, RFC.asPrivate);
  const body = await encryptPayload(RFC.plaintext, RFC.uaPublic, RFC.auth, { ephemeral, salt: unb64u(RFC.salt) });
  assert.equal(b64u(body), RFC.body);
});

test('a real subscription key pair decrypts what we send', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: '💬 تعليق جديد', body: 'نص عربي طويل '.repeat(20) });
  const body = await encryptPayload(message, b64u(uaPublic), b64u(auth));
  assert.equal(await decrypt(body, ua, uaPublic, auth), message);
});

test('only browser push services are accepted as endpoints', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/QK2'));
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!isPushEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!isPushEndpoint('https://evil.example.com/fcm.googleapis.com'));
  assert.ok(!isPushEndpoint('https://127.0.0.1/'));
});
