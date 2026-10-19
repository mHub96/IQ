// ER print fonts: upload (owner/admins), list, public file, delete; non-fonts and big files refused.
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/er-fonts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));
const AMIRI = fs.readFileSync(path.join(root, 'fonts', 'Amiri-Regular.ttf'));

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}
const login = async password => (await call('POST', '/api/login', { body: { password } })).data.token;
const t = {};

test('setup', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  t.user = await login(DATA.globalPasswords.user);
  assert.ok(t.owner && t.admin && t.user);
});

test('only the owner and admins upload; the file comes back byte for byte without a token', async () => {
  const body = { name: 'أميري', file: 'Amiri-Regular.ttf', data: AMIRI.toString('base64') };
  assert.equal((await call('POST', '/api/er-fonts', { token: t.user, body })).status, 403);
  assert.equal((await call('POST', '/api/er-fonts', { body })).status, 401);
  const up = await call('POST', '/api/er-fonts', { token: t.admin, body });
  assert.equal(up.status, 200);
  assert.equal(up.data.font.format, 'truetype');
  assert.equal(up.data.font.size, AMIRI.length);
  t.id = up.data.font.id;
  const list = await call('GET', '/api/er-fonts', { token: t.owner });
  assert.ok(list.data.fonts.some(f => f.id === t.id && !('data' in f)), 'listed without its data');
  const file = await fetch(BASE + '/api/er-fonts/file/' + t.id);
  assert.equal(file.status, 200);
  assert.ok(Buffer.from(await file.text(), 'base64').equals(AMIRI));
  assert.equal((await call('GET', '/api/er-fonts', { token: t.user })).status, 403);
});

test('non-fonts and oversized files are refused', async () => {
  const fake = await call('POST', '/api/er-fonts', { token: t.owner, body: { name: 'x', file: 'x.ttf', data: Buffer.from('<html>not a font</html>').toString('base64') } });
  assert.equal(fake.data.error, 'not_a_font');
  const big = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(1500 * 1024)]);
  const tooBig = await call('POST', '/api/er-fonts', { token: t.owner, body: { name: 'x', file: 'x.ttf', data: big.toString('base64') } });
  assert.equal(tooBig.status, 413);
  assert.equal((await call('POST', '/api/er-fonts', { token: t.owner, body: { data: 'not base64 !!' } })).status, 400);
});

test('delete: gone from the list and the file address', async () => {
  assert.equal((await call('POST', '/api/er-fonts/delete', { token: t.user, body: { id: t.id } })).status, 403);
  const del = await call('POST', '/api/er-fonts/delete', { token: t.owner, body: { id: t.id } });
  assert.equal(del.data.deleted, 1);
  assert.equal((await fetch(BASE + '/api/er-fonts/file/' + t.id)).status, 404);
  assert.ok(!(await call('GET', '/api/er-fonts', { token: t.owner })).data.fonts.some(f => f.id === t.id));
});
