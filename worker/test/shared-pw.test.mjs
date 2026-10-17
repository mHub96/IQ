// The owner's switch for the shared passwords, against a running Worker seeded like api.test.mjs.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/shared-pw.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA_FILE = process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json');
const PW = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).globalPasswords;

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async (password, extra = {}) => (await call('POST', '/api/login', { body: { password, ...extra } })).data;
const t = {};

test('shared passwords are on by default and shown', async () => {
  assert.equal((await call('GET', '/api/auth-config')).data.sharedPasswords, true);
  for (const role of ['owner', 'admin', 'user']) {
    const r = await login(PW[role]);
    assert.equal(r.success, true, role);
    t[role] = r.token;
  }
});

test('only the owner can switch them', async () => {
  assert.equal((await call('POST', '/api/shared-passwords', { token: t.admin, body: { active: false } })).status, 403);
  assert.equal((await call('POST', '/api/shared-passwords', { body: { active: false } })).status, 401);
});

test('switched off: refused at sign-in and existing sessions end (owner excepted)', async () => {
  const r = await call('POST', '/api/shared-passwords', { token: t.owner, body: { active: false } });
  assert.equal(r.data.sharedPasswords, false);
  assert.equal((await call('GET', '/api/auth-config')).data.sharedPasswords, false);
  const u = await login(PW.user);
  assert.equal(u.success, false);
  assert.equal(u.error, 'كلمة المرور غير صحيحة');
  assert.equal((await login(PW.admin)).success, false);
  assert.equal((await call('GET', '/api/session', { token: t.user })).status, 401);
  assert.equal((await call('GET', '/api/session', { token: t.admin })).status, 401);
  // The owner's password still opens (their way in), but not "as" a lower role.
  const o = await login(PW.owner, { roleHint: 'user' });
  assert.equal(o.success, true);
  assert.equal(o.role, 'owner');
  assert.equal((await call('GET', '/api/session', { token: t.owner })).status, 200);
});

test('switched back on: shared passwords work again', async () => {
  await call('POST', '/api/shared-passwords', { token: t.owner, body: { active: true } });
  assert.equal((await call('GET', '/api/auth-config')).data.sharedPasswords, true);
  assert.equal((await login(PW.user)).success, true);
  assert.equal((await call('GET', '/api/session', { token: t.user })).status, 200);
});
