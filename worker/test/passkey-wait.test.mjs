// A sign-up waiting on its device (approved: signed in by the same call; rejected: told so), and signing
// in with a passkey (a software authenticator stands in for the phone's fingerprint).
// Run: API_BASE=http://127.0.0.1:8790 node --test --test-concurrency=1 worker/test/passkey-wait.test.mjs
// Uses the local owner account; the accounts it creates are deleted at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc } from 'node:crypto';

const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const ORIGIN = process.env.SITE_ORIGIN || 'http://127.0.0.1:18097';
const OWNER = process.env.OWNER_USER || 'adm_mv7kjvs4', USER = process.env.TEST_USER || 'usr_mv7kjvs4', PASS = process.env.TEST_PASS || 'Pass-1234';
const HOSPITALS = ['basra', 'faw', 'zubair', 'iraqi'];

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function deriveKey(username, password) {
  const base = await wc.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await wc.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}
const login = async (u, dev = 'test-passkey-wait-dev01') => (await call('POST', '/api/accounts/login', { body: { username: u, key: await deriveKey(u, PASS), deviceId: dev, deviceLabel: 'Test' } })).data;
const b64url = b => Buffer.from(b).toString('base64url');

/** Sends a rotator sign-up (unlinked) into the first hospital that accepts it. */
async function rotatorSignup(tag) {
  const username = `t_wait_${tag}_${Date.now().toString(36)}`.slice(0, 24);
  const key = await deriveKey(username, PASS);
  for (const hosp of HOSPITALS) {
    const r = await call('POST', '/api/accounts/signup-rotator', { body: { hosp, name: `تجربة انتظار ${tag === 'a' ? 'أول' : 'ثاني'}`, phone: '07' + String(700000000 + Math.floor(Math.random() * 99999999)).slice(0, 9), username, key, sex: 'm', deviceId: 'test-wait-device-' + tag + '000' } });
    if (r.status === 200) return { username, ...r.data };
  }
  throw new Error('no hospital accepted the rotator sign-up');
}

const created = [];
let ownerTok = null;

test('a sign-up waits on its device: pending, then approved and signed in by the same call', async () => {
  ownerTok = (await login(OWNER)).token;
  assert.ok(ownerTok, 'owner login');
  const s = await rotatorSignup('a');
  created.push(s.username);
  assert.ok(s.ticket && s.ticket.includes('.'), 'a ticket comes with the request');
  const wait = body => call('POST', '/api/accounts/signup-wait', { body: { deviceId: 'test-wait-device-a000', deviceLabel: 'Test', ...body } });
  assert.equal((await wait({ ticket: s.ticket })).data.status, 'pending');
  assert.equal((await wait({ ticket: s.ticket.split('.')[0] + '.wrong' })).data.status, 'gone', 'a wrong secret learns nothing');
  const list = await call('GET', '/api/accounts?status=pending', { token: ownerTok });
  const acc = (list.data.accounts || []).find(a => a.username === s.username);
  assert.ok(acc, 'the request is listed for the approver');
  const ok = await call('POST', '/api/accounts/decide', { token: ownerTok, body: { id: acc.id, action: 'approve' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const done = await wait({ ticket: s.ticket });
  assert.equal(done.data.status, 'active');
  assert.ok(done.data.success && done.data.token, 'signed in');
  assert.equal(done.data.account.username, s.username);
  const me = await call('GET', '/api/accounts/me', { token: done.data.token });
  assert.equal(me.data.account.username, s.username, 'the token works');
  assert.equal((await wait({ ticket: s.ticket })).data.status, 'gone', 'the ticket is used once');
});

test('a rejected sign-up is told so', async () => {
  const s = await rotatorSignup('b');
  created.push(s.username);
  const list = await call('GET', '/api/accounts?status=pending', { token: ownerTok });
  const acc = (list.data.accounts || []).find(a => a.username === s.username);
  await call('POST', '/api/accounts/decide', { token: ownerTok, body: { id: acc.id, action: 'reject' } });
  const r = await call('POST', '/api/accounts/signup-wait', { body: { ticket: s.ticket, deviceId: 'test-wait-device-b000' } });
  assert.equal(r.data.status, 'rejected');
});

// ---- a software authenticator ----
function cborEncode(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  if (typeof v === 'number') return Buffer.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([Buffer.from(head(3, b.length)), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([Buffer.from(head(2, v.length)), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([Buffer.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [cborEncode(k), cborEncode(x)])]);
  throw new Error('cbor');
}
const sha = async b => Buffer.from(await wc.subtle.digest('SHA-256', b));
function rawToDer(raw) {
  const int = b => { let x = Buffer.from(b); while (x.length > 1 && x[0] === 0 && !(x[1] & 0x80)) x = x.slice(1); if (x[0] & 0x80) x = Buffer.concat([Buffer.from([0]), x]); return Buffer.concat([Buffer.from([2, x.length]), x]); };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}

test('passkeys: turn on, sign in with it, wrong signature refused, remove', async () => {
  const u = await login(USER);
  assert.ok(u && u.token, 'user login');
  const rpId = new URL(ORIGIN).hostname;
  const keys = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await wc.subtle.exportKey('jwk', keys.publicKey);
  const credId = wc.getRandomValues(new Uint8Array(32));
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);

  const opt = await call('POST', '/api/passkeys/register-options', { token: u.token, body: {} });
  assert.equal(opt.status, 200, JSON.stringify(opt.data));
  const clientReg = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opt.data.challenge, origin: ORIGIN }));
  const authReg = Buffer.concat([await sha(Buffer.from(rpId)), Buffer.from([0x45]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, 32]), Buffer.from(credId), cborEncode(cose)]);
  const att = cborEncode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authReg)]]));
  const reg = await call('POST', '/api/passkeys/register', { token: u.token, body: { token: opt.data.token, attestationObject: b64url(att), clientDataJSON: b64url(clientReg), label: 'Test' } });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal(reg.data.id, b64url(credId));

  const signIn = async (counter, tamper) => {
    const o = await call('POST', '/api/passkeys/login-options', { body: {} });
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.data.challenge, origin: ORIGIN }));
    const authData = Buffer.concat([await sha(Buffer.from(rpId)), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
    const raw = Buffer.from(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Buffer.concat([authData, await sha(client)])));
    if (tamper) raw[5] ^= 1;
    return call('POST', '/api/passkeys/login', { body: { token: o.data.token, id: b64url(credId), clientDataJSON: b64url(client), authenticatorData: b64url(authData), signature: b64url(rawToDer(raw)), deviceId: 'test-passkey-wait-dev02', deviceLabel: 'Test' } });
  };
  const good = await signIn(1);
  assert.equal(good.data.success, true, JSON.stringify(good.data));
  assert.equal(good.data.account.username, USER);
  assert.notEqual((await signIn(2, true)).data.success, true, 'a wrong signature is refused');
  assert.notEqual((await signIn(1)).data.success, true, 'a counter that does not go up is refused');
  assert.equal((await signIn(3)).data.success, true);

  const list = await call('GET', '/api/passkeys', { token: u.token });
  assert.ok(list.data.passkeys.some(p => p.id === b64url(credId)));
  await call('POST', '/api/passkeys/remove', { token: u.token, body: { id: b64url(credId) } });
  assert.equal((await signIn(4)).data.status, 'unknown_passkey', 'removed: no longer signs in');
});

test('clean up the accounts made here', async () => {
  const list = await call('GET', '/api/accounts', { token: ownerTok });
  for (const name of created) {
    const acc = (list.data.accounts || []).find(a => a.username === name);
    if (acc) await call('POST', '/api/accounts/decide', { token: ownerTok, body: { id: acc.id, action: 'delete' } });
  }
  const after = await call('GET', '/api/accounts', { token: ownerTok });
  assert.ok(!created.some(n => (after.data.accounts || []).some(a => a.username === n)));
});
