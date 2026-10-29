// Answers built from the records table, cached until a record changes (the free plan allows a limited
// number of rows read a day).
//
// The triggers of migration 0018 raise a counter in `data_rev` on every insert, update and delete of a
// record, whatever code makes it: 'main' (all but the ER scheduler), 'er', and 's:<hospital>' (that
// hospital's duties). A cached answer is stored under the counter's value, so after a change the next
// request looks for a new key and builds the answer again from the database: a cached copy is never
// served after a change. Reading a counter costs one row.
//
// Two layers: the Worker's own memory (the same instance answers many requests in a row) and the
// Cloudflare cache of the data centre (shared by the instances there). Neither is reachable from outside:
// only the code below reads them, after the request's permission checks.

const enc = new TextEncoder();
const VERSION = 'v1';
const EDGE_SECONDS = 7 * 24 * 60 * 60;
const MEM_BYTES = 24 * 1024 * 1024;

/** key -> { bytes: Uint8Array } | { value }, oldest first (a Map keeps insertion order). */
const mem = new Map();
let memBytes = 0;

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return undefined;
  mem.delete(key);
  mem.set(key, hit);
  return hit;
}

function memSet(key, entry, size) {
  if (size > MEM_BYTES / 4) return;
  const old = mem.get(key);
  if (old) { memBytes -= old.size; mem.delete(key); }
  entry.size = size;
  mem.set(key, entry);
  memBytes += size;
  for (const [k, e] of mem) {
    if (memBytes <= MEM_BYTES) break;
    mem.delete(k);
    memBytes -= e.size;
  }
}

const edgeKey = key => new Request(`https://rev-cache.internal/${VERSION}/${key}`);

// A random number written with the counters ('epoch'): part of every cache key, so copies cached before
// the counters table was ever made again (the counters starting over) are never taken for current ones.
// Read with the counters; until it is known nothing is cached.
let epoch = null;
const keyOf = (key, rev) => `${key}@${epoch}.${rev}`;
const noted = results => {
  const e = (results || []).find(r => r.k === 'epoch');
  epoch = e ? e.n : null;
};

/**
 * The counters' values: { name: n }. A missing counter is 0; on any error (migration 0018 not applied)
 * null, and the callers then read the database as before, without caching.
 */
export async function revisions(env, names) {
  try {
    const { results } = await env.DB.prepare("SELECT k, n FROM data_rev WHERE k = 'epoch' OR k IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(names)).all();
    noted(results);
    if (epoch === null) return null;
    const out = Object.fromEntries(names.map(n => [n, 0]));
    for (const r of results || []) out[r.k] = r.n;
    return out;
  } catch {
    return null;
  }
}

/** The counter as the clients keep it, with the epoch: "<epoch>.<n>" (null without the counters). */
export const revToken = n => (n === null || n === undefined || epoch === null ? null : `${epoch}.${n}`);

export async function revision(env, name) {
  const r = await revisions(env, [name]);
  return r ? r[name] : null;
}

/**
 * The 'main' counter and the blocks of the database download: [[key, n]] sorted by key ('c:<coll>',
 * 's:<hospital>'). Null without migration 0018.
 */
export async function blockRevisions(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT k, n FROM data_rev WHERE k IN ('main', 'epoch') OR (k >= 'c:' AND k < 'c;') OR (k >= 's:' AND k < 's;')"
    ).all();
    noted(results);
    const main = (results || []).find(r => r.k === 'main');
    if (!main || epoch === null) return null;
    const blocks = results.filter(r => r.k !== 'main' && r.k !== 'epoch').map(r => [r.k, r.n]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { main: main.n, blocks };
  } catch {
    return null;
  }
}

/**
 * Bytes cached under `key` at revision `rev`, else `build()` (a string) stored there.
 * Without a revision (null) the answer is built every time.
 */
export async function cachedBytes(key, rev, build) {
  if (rev === null || rev === undefined || epoch === null) return enc.encode(await build());
  const k = keyOf(key, rev);
  const m = memGet(k);
  if (m) return m.bytes;
  let bytes = null;
  try {
    const hit = await caches.default.match(edgeKey(k));
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
  } catch {}
  if (!bytes) {
    bytes = enc.encode(await build());
    try {
      await caches.default.put(edgeKey(k), new Response(bytes, { headers: { 'Cache-Control': `max-age=${EDGE_SECONDS}` } }));
    } catch {}
  }
  memSet(k, { bytes }, bytes.byteLength);
  return bytes;
}

/**
 * A JSON value cached under `key` at revision `rev`, else `build()` stored there. Callers must not
 * change the value they get (the same object answers the next requests).
 */
export async function cachedValue(key, rev, build) {
  if (rev === null || rev === undefined || epoch === null) return build();
  const k = keyOf(key, rev);
  const m = memGet(k);
  if (m) return m.value;
  let value;
  let size = 0;
  try {
    const hit = await caches.default.match(edgeKey(k));
    if (hit) { const text = await hit.text(); size = text.length * 2; value = JSON.parse(text); }
  } catch { value = undefined; }
  if (value === undefined) {
    value = await build();
    const text = JSON.stringify(value);
    size = text.length * 2;
    try {
      await caches.default.put(edgeKey(k), new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${EDGE_SECONDS}` } }));
    } catch {}
  }
  memSet(k, { value }, size);
  return value;
}

/**
 * Like cachedValue(), for answers that may lag a little behind a change: the copy built at another
 * revision is still used while it is under `maxAgeMs` old. For data changed many times an hour by
 * counters nobody needs to the minute (contact taps raise a duty's VisitCount, and with it its
 * hospital's 's:' counter): built again at most once per `maxAgeMs`, and never while nothing changed.
 */
export async function cachedRecent(key, rev, maxAgeMs, build) {
  if (rev === null || rev === undefined || epoch === null) return build();
  const k = keyOf(key, 'recent');
  const now = Date.now();
  const fresh = e => e && (e.rev === rev || now - e.at < maxAgeMs);
  let entry = memGet(k);
  if (!fresh(entry)) {
    entry = undefined;
    try {
      const hit = await caches.default.match(edgeKey(k));
      if (hit) { const e = await hit.json(); if (fresh(e)) entry = e; }
    } catch {}
    if (!entry) {
      entry = { rev, at: now, value: await build() };
      try {
        await caches.default.put(edgeKey(k), new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${EDGE_SECONDS}` } }));
      } catch {}
    }
    memSet(k, entry, JSON.stringify(entry.value).length * 2);
  }
  return entry.value;
}

/**
 * Every resident record of the hospital database, without phone numbers:
 * [{ id, name, dept, active, hospitals }] (`hospitals` as stored: the ids, usually strings). Read again
 * only after a resident record changed; callers must not change the list.
 */
export async function residentList(env) {
  return cachedValue('residents', await revision(env, 'c:resident'), async () => {
    const { results } = await env.DB.prepare(
      `SELECT id, json_extract(data, '$.name') AS name,
              COALESCE(json_extract(data, '$.dept'), json_extract(data, '$.spec'), json_extract(data, '$.tag')) AS dept,
              json_extract(data, '$.active') AS active, json_type(data, '$.hospitals') AS ht, json_extract(data, '$.hospitals') AS hs
         FROM records WHERE coll = 'resident'`
    ).all();
    return (results || []).map(r => {
      // As json_each() reads it: an array's items, a single value as itself, nothing when missing.
      let hospitals = [];
      if (r.ht === 'array' || r.ht === 'object') { try { hospitals = Object.values(JSON.parse(r.hs)); } catch {} }
      else if (r.ht && r.ht !== 'null') hospitals = [r.hs];
      return { id: r.id, name: r.name, dept: r.dept, active: r.active, hospitals };
    });
  });
}

/** The residents whose record lists the hospital (as `json_each(data, '$.hospitals') ... value = hosp`). */
export async function residentsOf(env, hosp) {
  return (await residentList(env)).filter(r => r.hospitals.some(h => h === hosp));
}

/** The memory layer's contents (tests). */
export const _memSize = () => ({ entries: mem.size, bytes: memBytes });
