// Automatic backups: the Action reads the data and stores the newest files; the site reads them back.
// Run against a local API (wrangler dev, BACKUP_KEY in .dev.vars):
//   API_BASE=http://127.0.0.1:8790 BACKUP_KEY=... OWNER_USER=... OWNER_PASS=... node --test test/backup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE;
const KEY = process.env.BACKUP_KEY;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = !API || !KEY || !process.env.OWNER_USER;

async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 }, base, 256);
  return Buffer.from(bits).toString('base64');
}
const call = async (method, p, { token, key, body } = {}) => {
  const res = await fetch(API + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'X-Backup-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

test('backups: key-only reading, the script writes and publishes, the owner and admins read theirs', { skip }, async () => {
  assert.equal((await call('GET', '/api/backup/rows')).status, 401);
  assert.equal((await call('GET', '/api/backup/rows', { key: 'wrong' })).status, 401);
  const page = await call('GET', '/api/backup/rows', { key: KEY });
  assert.ok(page.data.rows.length > 0);
  assert.equal((await call('PUT', '/api/backup/latest?f=full', { key: 'wrong', body: {} })).status, 401);

  // The backup script (as the GitHub Action runs it) against this API.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-backup-'));
  fs.copyFileSync(path.join(root, 'tools', 'backups', 'backup.mjs'), path.join(dir, 'backup.mjs'));
  fs.copyFileSync(path.join(root, 'hub-sync.js'), path.join(dir, 'hub-sync.js'));
  const env = { ...process.env, API_BASE: API, BACKUP_KEY: KEY, REF: 'test' };
  execFileSync(process.execPath, ['backup.mjs'], { cwd: dir, env, stdio: 'pipe' });
  const full = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'full-backup.json'), 'utf8'));
  assert.equal(full.format, 'hosp_hub_full_system_backup');
  assert.ok(Object.keys(full.hubDatabase.hospitals).length > 0);
  assert.ok(full.hubDatabase.residents.length > 0);
  const hospId = Object.keys(full.hubDatabase.hospitals)[0];
  const one = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'hospitals', hospId + '.json'), 'utf8'));
  assert.equal(one.format, 'hospital_hub_hospital_backup');
  assert.ok(Array.isArray(one.structure.schedule));
  execFileSync(process.execPath, ['backup.mjs', '--publish'], { cwd: dir, env, stdio: 'pipe' });

  // Signed in: the owner reads the full backup and every hospital's; nobody else reads the full one.
  const login = await call('POST', '/api/accounts/login', { body: { username: process.env.OWNER_USER, key: await deriveKey(process.env.OWNER_USER, process.env.OWNER_PASS), deviceId: 'backup-test-device-0001', deviceLabel: 'backup test' } });
  const owner = login.data.token;
  assert.ok(owner, 'owner signed in');
  assert.equal((await call('GET', '/api/backup/info')).status, 401);
  const info = await call('GET', '/api/backup/info', { token: owner });
  assert.ok(info.data.full && info.data.full.at > 0);
  assert.ok(info.data.hospitals[hospId]);
  const got = await call('GET', '/api/backup/latest?f=full', { token: owner });
  assert.equal(got.data.format, 'hosp_hub_full_system_backup');
  assert.equal((await call('GET', '/api/backup/latest?f=' + encodeURIComponent('hosp:' + hospId), { token: owner })).data.hospitalId, hospId);
  assert.equal((await call('GET', '/api/backup/latest?f=full')).status, 401);
  if (process.env.USER_USER) {
    const u = await call('POST', '/api/accounts/login', { body: { username: process.env.USER_USER, key: await deriveKey(process.env.USER_USER, process.env.USER_PASS), deviceId: 'backup-test-device-0002', deviceLabel: 'backup test' } });
    assert.equal((await call('GET', '/api/backup/latest?f=full', { token: u.data.token })).status, 403);
    assert.equal((await call('GET', '/api/backup/info', { token: u.data.token })).status, 403);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
