/**
 * Administrative Affairs division (الشؤون الإدارية): one per hospital.
 *
 * The division has the same data shape as the doctors' side (job titles = specialties, officers =
 * residents, a daily roster and a monthly schedule), so the existing pages run on it unchanged in
 * "division mode" (hub-core.js). Its rows live in `aa_records`, partitioned by hospital, and are
 * never part of /api/db:
 *   - the owner, the hospital's admins and the division's own accounts read and edit it here;
 *   - division admins (and the owner / hospital admins) edit everything, division users only the
 *     schedule (duty exchange);
 *   - the doctors' roster can show a read-only mirror of chosen job titles: a hospital admin adds a
 *     "clone" specialty pointing at the virtual hospital `aa__<hospital>` and /api/aa/mirror serves
 *     just those job titles' duties.
 */

import { DAY, json, readJson, overLimit, neutralize, plainText } from './lib.js';
import { nameKey, nameTokens, phoneKey } from './names.js';
import { dutyDayNow } from './profile.js';

export const AA_ROLES = ['aa_user', 'aa_admin'];
export const isOfficer = a => !!a && AA_ROLES.includes(a.r);
/** Id of the virtual hospital the doctors' roster mirrors job titles from. */
export const mirrorId = hosp => 'aa__' + hosp;

const HOSP_RE = /^[\w-]{1,48}$/;
const PAGE_ROWS = 1500;
const HISTORY_KEEP_DAYS = 120;
const VISIT_COOLDOWN_MS = 60 * 1000;
const COLLS = new Set(['meta', 'hospital', 'sched', 'resident']);
// Display fields of the division's hospital record always follow the hospital itself.
const DISPLAY_FIELDS = ['hospitalName', 'name_ar', 'location', 'icon', 'color'];

/** 'admin' | 'user' | null — what `auth` may do in hospital `hosp`'s division. */
export function aaAccess(auth, hosp) {
  if (!auth || !HOSP_RE.test(String(hosp || ''))) return null;
  if (auth.r === 'owner') return 'admin';
  if (auth.r === 'admin' && (auth.h || []).some(h => h === '*' || h === hosp)) return 'admin';
  if (auth.a && auth.hosp === hosp) {
    if (auth.r === 'aa_admin') return 'admin';
    if (auth.r === 'aa_user') return 'user';
  }
  return null;
}

/** Routes under /api/aa. Returns null when not matched. */
export async function routeAA(path, method, request, env, auth, url) {
  if (!path.startsWith('/api/aa/')) return null;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hosp = String(url.searchParams.get('h') || '');
  switch (`${method} ${path}`) {
    case 'GET /api/aa/jobs': return publicJobs(env, hosp, ip);
    case 'POST /api/aa/check': return checkOfficer(request, env, ip);
    case 'GET /api/aa/mirror': return auth ? mirror(env, auth, hosp) : json({ error: 'unauthorized' }, 401);
  }
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const level = aaAccess(auth, hosp);
  if (!level) return json({ error: 'forbidden' }, 403);
  if (!(await mainHospital(env, hosp))) return json({ error: 'not_found' }, 404);
  switch (`${method} ${path}`) {
    case 'GET /api/aa/db': return readDivision(env, auth, hosp, url);
    case 'POST /api/aa/sync': return syncDivision(request, env, auth, hosp, level);
    case 'POST /api/aa/visit': return visit(request, env, auth, hosp, ip);
  }
  return json({ error: 'not_found' }, 404);
}

async function mainHospital(env, hosp) {
  if (!HOSP_RE.test(hosp)) return null;
  const row = await env.DB.prepare("SELECT data FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp).first();
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

/** The division's hospital record (job titles, officers), or null before it was first saved. */
async function divisionRecord(env, hosp) {
  const row = await env.DB.prepare("SELECT data, v FROM aa_records WHERE hosp = ? AND coll = 'hospital' AND id = ?").bind(hosp, hosp).first();
  if (!row) return null;
  try { return { data: JSON.parse(row.data), v: row.v }; } catch { return null; }
}

const isJob = s => s && s.id && !s.isClone && s.enabled !== false;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Wire format of a row: [coll, id, hosp, ord, v, data] like /api/db. `hosp` is only set where the
// browser expects it (schedule slots and the hospital record).
const ROW_SQL = (alias, overlay) => `json_array(${alias}.coll, ${alias}.id,
    CASE WHEN ${alias}.coll IN ('sched', 'hospital') THEN ${alias}.hosp END, ${alias}.ord, ${alias}.v,
    json(CASE WHEN ${alias}.coll = 'hospital' THEN ${overlay} ELSE ${alias}.data END))`;
const OVERLAY = `json_set(a.data, ${DISPLAY_FIELDS.map(f => `'$.${f}', COALESCE(json_extract(m.data, '$.${f}'), json_extract(a.data, '$.${f}'))`).join(', ')})`;

async function readDivision(env, auth, hosp, url) {
  const since = Number(url.searchParams.get('since'));
  if (since > 0) return readChanges(env, auth, hosp, since);
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const row = await env.DB.prepare(
    `SELECT json_group_array(${ROW_SQL('a', OVERLAY)}) AS rows, MAX(a.rid) AS last, COUNT(*) AS n
       FROM (SELECT rowid AS rid, * FROM aa_records WHERE hosp = ?1 AND rowid > ?2 ORDER BY rowid LIMIT ${PAGE_ROWS}) a
       LEFT JOIN records m ON m.coll = 'hospital' AND m.id = a.hosp`
  ).bind(hosp, after).first();
  const n = row ? row.n : 0;
  let rows = n ? row.rows : '[]';
  // A division that was never saved starts as an empty hospital (version 0: the first save creates it).
  if (after === 0 && !(await divisionRecord(env, hosp))) {
    const main = await mainHospital(env, hosp) || {};
    const blank = { id: hosp, specialties: [], names: [] };
    for (const f of DISPLAY_FIELDS) if (main[f] !== undefined) blank[f] = main[f];
    const synthetic = JSON.stringify(['hospital', hosp, hosp, 0, 0, blank]);
    rows = rows === '[]' ? `[${synthetic}]` : `[${synthetic},${rows.slice(1)}`;
  }
  const body = `{"rows":${rows},"last":${n ? row.last : after},"more":${n === PAGE_ROWS},"full":true,"role":${JSON.stringify(auth.r)},"time":${Date.now()}}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function readChanges(env, auth, hosp, since) {
  if (Date.now() - since > (HISTORY_KEEP_DAYS - 7) * DAY) return json({ reset: true });
  const [changed, deleted] = await env.DB.batch([
    env.DB.prepare(
      `SELECT json_group_array(${ROW_SQL('a', OVERLAY)}) AS rows, COUNT(*) AS n
         FROM (SELECT * FROM aa_records WHERE hosp = ?1 AND updated_at >= ?2 LIMIT 2001) a
         LEFT JOIN records m ON m.coll = 'hospital' AND m.id = a.hosp`
    ).bind(hosp, since),
    env.DB.prepare(
      `SELECT json_group_array(json_array(coll, id)) AS rows, COUNT(*) AS n
         FROM (SELECT DISTINCT coll, id FROM aa_history WHERE hosp = ?1 AND deleted = 1 AND ts >= ?2 LIMIT 2001)`
    ).bind(hosp, since),
  ]);
  const c = changed.results[0], d = deleted.results[0];
  if (c.n > 2000 || d.n > 2000) return json({ reset: true });
  const body = `{"changed":${c.n ? c.rows : '[]'},"deleted":${d.n ? d.rows : '[]'},"full":true,"role":${JSON.stringify(auth.r)},"time":${Date.now()}}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---------------------------------------------------------------------------
// Writes (same protocol as /api/sync: versions, conflicts, rejected ops)
// ---------------------------------------------------------------------------

function opAllowed(level, hosp, op) {
  if (!COLLS.has(op.c)) return false;
  switch (op.c) {
    case 'sched':
      // Everyone in the division exchanges duties; the slot must belong to this hospital.
      return op.id.startsWith(hosp + ':') && (op.del || op.ordOnly || op.h === hosp);
    case 'hospital':
      return level === 'admin' && op.id === hosp && !op.del;
    default: // meta, resident
      return level === 'admin';
  }
}

async function syncDivision(request, env, auth, hosp, level) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length === 0) return json({ applied: [], conflicts: [], rejected: [] });
  if (ops.length > 2000) return json({ error: 'too_many_ops' }, 413);

  const now = Date.now();
  const wid = crypto.randomUUID();
  const by = auth.a ? `${auth.r}:${auth.name}` : auth.r;
  const msg = String(body.msg || '').slice(0, 300);

  const puts = [], dels = [], ords = [], rejected = [], checks = [];
  ops.forEach((op, i) => {
    if (!op || typeof op.c !== 'string' || typeof op.id !== 'string' || !op.id || op.id.length > 200) { rejected.push(i); return; }
    if (!opAllowed(level, hosp, op)) { rejected.push(i); return; }
    const bv = Number(op.bv) || 0;
    if (op.ordOnly) {
      ords.push({ c: op.c, id: op.id, o: Number(op.o) || 0 });
    } else if (op.del) {
      dels.push({ c: op.c, id: op.id, bv });
      checks.push({ i, c: op.c, id: op.id, del: 1 });
    } else {
      if (op.d === undefined) { rejected.push(i); return; }
      puts.push({ c: op.c, id: op.id, o: Number(op.o) || 0, bv, dt: neutralize(JSON.stringify(op.d)) });
      checks.push({ i, c: op.c, id: op.id, del: 0 });
    }
  });

  const stmts = [];
  const prev = [...puts.map(p => ({ c: p.c, id: p.id, bv: p.bv, del: 0 })), ...dels.map(p => ({ ...p, del: 1 }))];
  if (prev.length) {
    stmts.push(env.DB.prepare(
      `INSERT INTO aa_history (hosp, coll, id, v, data, deleted, ts, by, msg)
       SELECT r.hosp, r.coll, r.id, r.v, r.data, json_extract(j.value, '$.del'), ?2, ?3, ?4
         FROM json_each(?1) j JOIN aa_records r
           ON r.hosp = ?5 AND r.coll = json_extract(j.value, '$.c') AND r.id = json_extract(j.value, '$.id') AND r.v = json_extract(j.value, '$.bv')`
    ).bind(JSON.stringify(prev), now, by, msg, hosp));
  }
  if (puts.length) {
    stmts.push(env.DB.prepare(
      `INSERT INTO aa_records (hosp, coll, id, ord, v, data, updated_at, updated_by, wid)
       SELECT ?5, json_extract(j.value, '$.c'), json_extract(j.value, '$.id'), json_extract(j.value, '$.o'),
              json_extract(j.value, '$.bv') + 1, json(json_extract(j.value, '$.dt')), ?2, ?3, ?4
         FROM json_each(?1) j WHERE true
       ON CONFLICT (hosp, coll, id) DO UPDATE SET
         ord = excluded.ord, v = excluded.v, data = excluded.data,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by, wid = excluded.wid
       WHERE aa_records.v = excluded.v - 1`
    ).bind(JSON.stringify(puts), now, by, wid, hosp));
  }
  if (dels.length) {
    stmts.push(env.DB.prepare(
      `DELETE FROM aa_records WHERE hosp = ?2 AND (coll, id, v) IN (
         SELECT json_extract(value, '$.c'), json_extract(value, '$.id'), json_extract(value, '$.bv') FROM json_each(?1))`
    ).bind(JSON.stringify(dels), hosp));
  }
  if (ords.length) {
    stmts.push(env.DB.prepare(
      `UPDATE aa_records SET ord = (
         SELECT json_extract(j.value, '$.o') FROM json_each(?1) j
          WHERE json_extract(j.value, '$.c') = aa_records.coll AND json_extract(j.value, '$.id') = aa_records.id)
       WHERE hosp = ?2 AND (coll, id) IN (SELECT json_extract(value, '$.c'), json_extract(value, '$.id') FROM json_each(?1))`
    ).bind(JSON.stringify(ords), hosp));
  }
  stmts.push(env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, ?)').bind(now, by, `[AA ${hosp}] ${msg}`.slice(0, 300), ops.length - rejected.length));

  const checkIndex = stmts.length;
  if (checks.length) {
    stmts.push(env.DB.prepare(
      `SELECT json_extract(j.value, '$.i') AS i, json_extract(j.value, '$.del') AS del, r.v AS v, r.wid AS wid, r.data AS data
         FROM json_each(?1) j LEFT JOIN aa_records r
           ON r.hosp = ?2 AND r.coll = json_extract(j.value, '$.c') AND r.id = json_extract(j.value, '$.id')`
    ).bind(JSON.stringify(checks), hosp));
  }

  const results = await env.DB.batch(stmts);
  const applied = [], conflicts = [];
  if (checks.length) {
    for (const row of results[checkIndex].results) {
      if (row.del) {
        if (row.v === null) applied.push([row.i, 0]);
        else conflicts.push([row.i, row.v, row.data]);
      } else if (row.wid === wid) {
        applied.push([row.i, row.v]);
      } else {
        conflicts.push([row.i, row.v, row.data]);
      }
    }
  }
  return json({ applied, conflicts, rejected, ordered: ords.length });
}

/** Contact-tap counter on a division roster card (same one-per-minute rule as the doctors' roster). */
async function visit(request, env, auth, hosp, ip) {
  const body = await readJson(request);
  const id = String((body && body.id) || '');
  if (!id) return json({ error: 'bad_request' }, 400);
  const now = Date.now();
  const entry = await env.DB.prepare("SELECT json_extract(data, '$.name') AS name, json_extract(data, '$.VisitCount') AS count, v FROM aa_records WHERE hosp = ? AND coll = 'sched' AND id = ?")
    .bind(hosp, id).first();
  if (!entry) return json({ error: 'not_found' }, 404);
  const who = auth.a ? 'a:' + auth.a : auth.dv ? 'd:' + auth.dv : 'ip:' + ip + ':' + auth.r;
  const key = `${who}|${mirrorId(hosp)}|${nameKey(entry.name)}|${dutyDayNow(now)}`;
  const claimed = await env.DB.prepare(
    `INSERT INTO visit_cooldown (k, ts) VALUES (?1, ?2)
     ON CONFLICT (k) DO UPDATE SET ts = excluded.ts WHERE visit_cooldown.ts <= ?3
     RETURNING ts`
  ).bind(key, now, now - VISIT_COOLDOWN_MS).first();
  if (!claimed) return json({ ok: true, cooldown: true, count: entry.count || 0, v: entry.v });
  const row = await env.DB.prepare(
    `UPDATE aa_records SET data = json_set(data, '$.VisitCount', COALESCE(json_extract(data, '$.VisitCount'), 0) + 1),
            v = v + 1, updated_at = ?3, updated_by = ?4, wid = NULL
      WHERE hosp = ?1 AND coll = 'sched' AND id = ?2
      RETURNING v, json_extract(data, '$.VisitCount') AS count`
  ).bind(hosp, id, now, auth.r).first();
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ ok: true, v: row.v, count: row.count });
}

// ---------------------------------------------------------------------------
// Mirror for the doctors' roster
// ---------------------------------------------------------------------------

/** "DD/MM/YYYY" -> "YYYYMMDD" in SQL, for date windows. */
const SORTABLE_DATE = "(substr(json_extract(data, '$.date'), 7, 4) || substr(json_extract(data, '$.date'), 4, 2) || substr(json_extract(data, '$.date'), 1, 2))";
const ymd = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * The virtual hospital `aa__<hosp>`: the job titles the hospital's doctors' roster mirrors (clone
 * specialties of the hospital itself), their duties from 70 days ago to a year ahead, and the
 * officers on those duties (phone numbers for signed-in users only). People with access to the
 * division also get every job title, so a hospital admin can pick which ones to mirror.
 */
async function mirror(env, auth, hosp) {
  const main = await mainHospital(env, hosp);
  if (!main) return json({ error: 'not_found' }, 404);
  const vid = mirrorId(hosp);
  const mirrored = new Set((main.specialties || []).filter(s => s && s.isClone && s.clonedFromHospitalId === vid).map(s => s.clonedFromSpecId));
  const division = await divisionRecord(env, hosp);
  const jobs = ((division && division.data.specialties) || []).filter(isJob);
  const seesAll = !!aaAccess(auth, hosp);
  const out = {
    id: vid, isDivision: true, parentHospitalId: hosp,
    name_ar: 'الشؤون الإدارية', hospitalName: 'Administrative Affairs',
    color: main.color || '#475569', icon: 'fa-building',
    specialties: jobs.filter(j => seesAll || mirrored.has(j.id)),
    names: [], schedule: [],
  };
  if (mirrored.size) {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      `SELECT data FROM aa_records WHERE hosp = ?1 AND coll = 'sched'
          AND json_extract(data, '$.specCode') IN (SELECT value FROM json_each(?2))
          AND ${SORTABLE_DATE} BETWEEN ?3 AND ?4
        ORDER BY ord LIMIT 5000`
    ).bind(hosp, JSON.stringify([...mirrored]), ymd(now - 70 * DAY), ymd(now + 400 * DAY)).all();
    out.schedule = results.map(r => JSON.parse(r.data));
    const onDuty = new Set(out.schedule.map(e => nameKey(e.name)));
    out.names = ((division && division.data.names) || [])
      .filter(n => n && onDuty.has(nameKey(n.name)))
      .map(n => ({ id: n.id, name: n.name, spec: n.spec, dept: n.dept, active: n.active, ...(auth ? { phone: n.phone } : {}) }));
  }
  return json({ ok: true, hospital: out, time: Date.now() });
}

// ---------------------------------------------------------------------------
// Sign-up helpers (job titles, identity check) — used before signing in
// ---------------------------------------------------------------------------

async function publicJobs(env, hosp, ip) {
  if (await overLimit(env, 'aajobs:' + ip, 120)) return json({ error: 'rate_limited' }, 429);
  if (!(await mainHospital(env, hosp))) return json({ ok: true, jobs: [] });
  const division = await divisionRecord(env, hosp);
  const jobs = ((division && division.data.specialties) || []).filter(isJob)
    .map(j => ({ id: j.id, name_ar: j.name_ar || j.id, name_en: j.name_en || '', icon: j.icon || '', prefix: j.prefix === undefined ? '' : j.prefix }));
  return json({ ok: true, jobs });
}

/** Finds an officer of the division by name + phone. Never tells which part did not match. */
export async function findOfficer(env, hosp, name, phone) {
  const pk = phoneKey(phone);
  if (!pk || !HOSP_RE.test(hosp) || !name) return { pk, match: null };
  const division = await divisionRecord(env, hosp);
  const { results } = await env.DB.prepare("SELECT data FROM aa_records WHERE hosp = ? AND coll = 'resident'").bind(hosp).all();
  const candidates = [...((division && division.data.names) || []), ...results.map(r => { try { return JSON.parse(r.data); } catch { return null; } })];
  // The phone number identifies the officer; the first name confirms it (as for residents).
  const first = nameTokens(name)[0] || '';
  const match = candidates.find(c => c && c.id && phoneKey(c.phone) === pk && first.length >= 2 && nameTokens(c.name)[0] === first) || null;
  return { pk, match };
}

export const officerLink = (hosp, id) => `aa:${hosp}:${id}`;

async function checkOfficer(request, env, ip) {
  if (await overLimit(env, 'check:' + ip, 60)) return json({ error: 'rate_limited' }, 429);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const hosp = String(body.hosp || '');
  const { match } = await findOfficer(env, hosp, String(body.name || ''), String(body.phone || ''));
  if (!match) return json({ ok: true, match: false });
  const taken = await env.DB.prepare("SELECT 1 AS t FROM accounts WHERE resident_id = ? AND status IN ('pending', 'active')").bind(officerLink(hosp, match.id)).first();
  return json({ ok: true, match: true, taken: !!taken, name: match.name, job: match.spec || null });
}

/** The job title `jobId` of the division, or null. */
export async function divisionJob(env, hosp, jobId) {
  const division = await divisionRecord(env, hosp);
  return ((division && division.data.specialties) || []).find(j => isJob(j) && j.id === jobId) || null;
}

const TITLE_RE = /^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s:/]+/i;
/** Same as the browser's formatMemberName: the job title's prefix in front of the bare name. */
function withPrefix(name, prefix) {
  const bare = String(name || '').trim().replace(TITLE_RE, '').trim();
  const p = String(prefix === undefined ? '' : prefix).trim();
  return p ? `${p} ${bare}` : bare;
}

/**
 * Adds an approved officer who was not in the division's database yet, under the job title they
 * chose. Writes both lists the pages read (the officers list and the hospital record's names) and
 * bumps the versions, so open pages merge it in on their next save or refresh.
 * Returns the new officer's link for accounts.resident_id.
 */
export async function addOfficer(env, { hosp, name, phone, job, by }) {
  const division = await divisionRecord(env, hosp);
  const jobDef = ((division && division.data.specialties) || []).find(j => j && j.id === job) || {};
  const id = 'res-' + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
  const officer = {
    id, name: withPrefix(plainText(name, 80), jobDef.prefix), phone: '+964' + phoneKey(phone),
    spec: job, tag: job, dept: job, department: job, active: true, hospitals: [hosp],
  };
  const now = Date.now();
  const text = JSON.stringify(officer);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO aa_records (hosp, coll, id, ord, v, data, updated_at, updated_by)
       VALUES (?1, 'resident', ?2, (SELECT COALESCE(MAX(ord), 0) + 1 FROM aa_records WHERE hosp = ?1 AND coll = 'resident'), 1, ?3, ?4, ?5)`
    ).bind(hosp, id, text, now, by),
  ];
  if (division) {
    stmts.push(env.DB.prepare(
      `UPDATE aa_records SET data = json_insert(data, '$.names[#]', json(?3)), v = v + 1, updated_at = ?4, updated_by = ?5, wid = NULL
        WHERE hosp = ?1 AND coll = 'hospital' AND id = ?2`
    ).bind(hosp, hosp, text, now, by));
  }
  await env.DB.batch(stmts);
  return { link: officerLink(hosp, id), name: officer.name };
}
