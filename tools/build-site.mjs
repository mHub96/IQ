// Copies the website (and nothing else) into dist/ for Cloudflare Pages.
// Run from anywhere: node tools/build-site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const SITE_EXT = new Set(['.html', '.js', '.css', '.svg', '.webmanifest', '.json', '.png', '.ico', '.txt']);
const SKIP = new Set(['package.json', 'package-lock.json', 'hub-data.json', 'data.json']);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
let n = 0;
for (const name of fs.readdirSync(root)) {
  const src = path.join(root, name);
  if (fs.statSync(src).isFile() && SITE_EXT.has(path.extname(name).toLowerCase()) && !SKIP.has(name)) {
    fs.copyFileSync(src, path.join(dist, name));
    n++;
  }
}
if (fs.existsSync(path.join(root, 'fonts'))) {
  fs.cpSync(path.join(root, 'fonts'), path.join(dist, 'fonts'), { recursive: true });
}
// Pages headers: the service worker and pages must always be revalidated.
fs.writeFileSync(path.join(dist, '_headers'), [
  '/service-worker.js',
  '  Cache-Control: no-cache',
  '/*.html',
  '  Cache-Control: no-cache',
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
  '',
].join('\n'));
console.log(`dist/: ${n} files + fonts/ + _headers`);
