// Builds worker/.local/import.sql from a hub-data.json snapshot.
// Usage: node scripts/build-import.mjs <path-to-hub-data.json> [--commit <sha>]
// Creates worker/.local/secrets.json (SESSION_KEY, PW_KEY, BRIDGE_KEY) on first run.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const HubSync = require(path.join(here, '..', '..', 'hub-sync.js'));

const args = process.argv.slice(2);
const src = args[0];
const commit = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : null;
if (!src) {
  console.error('Usage: node scripts/build-import.mjs <hub-data.json> [--commit <sha>]');
  process.exit(1);
}

const localDir = path.join(here, '..', '.local');
fs.mkdirSync(localDir, { recursive: true });
const secretsPath = path.join(localDir, 'secrets.json');
const rand = n => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64');
if (!fs.existsSync(secretsPath)) {
  fs.writeFileSync(secretsPath, JSON.stringify({ SESSION_KEY: rand(32), PW_KEY: rand(32), BRIDGE_KEY: rand(24).replace(/[^A-Za-z0-9]/g, '') }, null, 2));
  console.log('Generated new secrets in', secretsPath);
}
const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));

const db = JSON.parse(fs.readFileSync(src, 'utf8'));
const { records, secrets: passwords } = HubSync.decompose(db);

const q = s => s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'";
// Same rule the Worker applies to every write (see neutralize() in src/index.js).
const neutralize = t => t.replace(/[<>`]/g, '').replace(/'/g, '\u2019').replace(/\\(["\\])/g, (_, c) => (c === '"' ? '\u201D' : '/'));
const now = Date.now();
const lines = [
  'DELETE FROM records;',
  'DELETE FROM secrets;',
  'DELETE FROM history;',
];
for (const r of records.values()) {
  if (r.s.length > 1900000) throw new Error(`Record ${r.c}/${r.id} is too large for D1 (${r.s.length} bytes)`);
  lines.push(`INSERT INTO records (coll, id, hosp, ord, v, data, updated_at, updated_by) VALUES (${q(r.c)}, ${q(r.id)}, ${q(r.h)}, ${r.o}, 1, json(${q(neutralize(r.s))}), ${now}, 'import');`);
}

const key = await crypto.subtle.importKey('raw', Buffer.from(secrets.PW_KEY, 'base64'), 'AES-GCM', false, ['encrypt']);
async function encrypt(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString('base64');
}
let pwCount = 0;
for (const [scope, roles] of Object.entries(passwords)) {
  for (const [role, pwd] of Object.entries(roles || {})) {
    if (!['owner', 'admin', 'anaesthesia', 'user'].includes(role) || !pwd) continue;
    lines.push(`INSERT INTO secrets (scope, role, enc) VALUES (${q(scope)}, ${q(role)}, ${q(await encrypt(String(pwd).trim()))});`);
    pwCount++;
  }
}
if (commit) {
  const state = JSON.stringify({ commit, importedAt: now });
  lines.push(`INSERT INTO kv (k, v) VALUES ('bridge', ${q(state)}) ON CONFLICT(k) DO UPDATE SET v = excluded.v;`);
}
lines.push(`INSERT INTO audit (ts, role, msg, n) VALUES (${now}, 'import', ${q('Initial import' + (commit ? ' from ' + commit : ''))}, ${records.size});`);

const out = path.join(localDir, 'import.sql');
fs.writeFileSync(out, lines.join('\n') + '\n');
const counts = {};
for (const r of records.values()) counts[r.c] = (counts[r.c] || 0) + 1;
console.log('Wrote', out, { records: records.size, ...counts, passwords: pwCount, bytes: fs.statSync(out).size });
