// Automatic backup of the Hospital Hub data (run by .github/workflows/backup.yml every 5 hours).
//
// Reads every record through the API (/api/backup/rows, X-Backup-Key), and writes:
//   data/records.json            the raw records [coll, id, hosp, ord, v, data] (everything, re-importable)
//   data/full-backup.json        the owner's full-system backup format (hubDatabase + ER data)
//   data/hospitals/<id>.json     each hospital in the hospital admin's backup format
// The workflow commits them (git history = every backup), then this script, run with --publish, puts the
// newest files back in the Worker so the site's restore screens offer "the latest automatic backup".
//
// Env: API_BASE (e.g. https://hosp-hub-api.mrjuniversity.workers.dev), BACKUP_KEY, REF (commit, --publish).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HubSync = require('./hub-sync.js');
const API = (process.env.API_BASE || '').replace(/\/+$/, '');
const KEY = process.env.BACKUP_KEY || '';
const OUT = path.resolve('data');
if (!API || !KEY) { console.error('API_BASE and BACKUP_KEY are required'); process.exit(1); }

const ER_STATE = 'hosp_hub_emergency_state_v3';
const ER_SCHED = 'hosp_hub_emergency_sched_';
const ER_ALLOC = 'hosp_hub_emergency_alloc_';
const ER_COLORS = 'hosp_hub_emergency_specialty_colors';

async function call(method, p, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + p, { method, headers: { 'X-Backup-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
      if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise(r => setTimeout(r, attempt * 5000));
    }
  }
}

async function readAll() {
  const rows = [];
  let after = 0;
  for (;;) {
    const page = await call('GET', `/api/backup/rows?after=${after}`);
    rows.push(...page.rows);
    after = page.last;
    if (!page.more) break;
  }
  return rows;
}

function hospitalFile(db, id, made) {
  const h = db.hospitals[id];
  const names = (db.residents || []).filter(r => Array.isArray(r.hospitals) && r.hospitals.includes(id));
  const specialties = (h.specialties || []).map(s => ({ ...s }));
  return {
    format: 'hospital_hub_hospital_backup',
    version: '3.0',
    automatic: true,
    exportedAt: made.toISOString(),
    exportDateFormatted: made.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' }),
    hospitalId: id,
    hospitalName: h.hospitalName || '',
    name_ar: h.name_ar || '',
    location: h.location || '',
    icon: h.icon || 'fa-hospital',
    color: h.color || '#0f766e',
    rotationHeroesUrl: h.rotationHeroesUrl || '',
    totalSpecialties: specialties.length,
    enabledSpecialtiesCount: specialties.filter(s => s.enabled !== false).length,
    totalResidents: names.length,
    activeResidentsCount: names.filter(r => r.active !== false).length,
    inactiveResidentsCount: names.filter(r => r.active === false).length,
    specialties,
    residents: names,
    names,
    structure: { schedule: h.schedule || [], specialistSchedule: h.specialistSchedule || {}, icu: h.icu || {} },
  };
}

async function build() {
  const made = new Date();
  const rows = await readAll();
  if (!rows.some(r => r[0] === 'hospital')) throw new Error('No hospitals in the data: refusing to write an empty backup');
  const db = HubSync.compose(rows.filter(r => r[0] !== 'er'));
  const er = rows.filter(r => r[0] === 'er');
  const emergencySchedules = {}, emergencyAllocations = {};
  let emergencyState = null, emergencyColors = null;
  for (const [, id, , , , data] of er) {
    if (id === ER_STATE) emergencyState = data;
    else if (id === ER_COLORS) emergencyColors = data;
    else if (id.startsWith(ER_SCHED)) emergencySchedules[id.slice(ER_SCHED.length)] = data;
    else if (id.startsWith(ER_ALLOC)) emergencyAllocations[id.slice(ER_ALLOC.length)] = data;
  }
  const full = {
    format: 'hosp_hub_full_system_backup',
    version: '3.5',
    automatic: true,
    exportedAt: made.toISOString(),
    exportDateFormatted: made.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' }),
    hubDatabase: db,
    emergencyState,
    emergencyAllocations,
    emergencySchedules,
    emergencyColors,
  };
  fs.rmSync(path.join(OUT, 'hospitals'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'hospitals'), { recursive: true });
  // One record per line: small diffs between backups, so the history stays compact.
  fs.writeFileSync(path.join(OUT, 'records.json'), '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]\n');
  fs.writeFileSync(path.join(OUT, 'full-backup.json'), JSON.stringify(full, null, 1));
  for (const id of Object.keys(db.hospitals)) {
    fs.writeFileSync(path.join(OUT, 'hospitals', id + '.json'), JSON.stringify(hospitalFile(db, id, made), null, 1));
  }
  fs.writeFileSync(path.join(OUT, 'made.json'), JSON.stringify({ at: made.getTime(), iso: made.toISOString(), records: rows.length }) + '\n');
  const counts = rows.reduce((m, r) => (m[r[0]] = (m[r[0]] || 0) + 1, m), {});
  console.log('Backup written:', rows.length, 'records', JSON.stringify(counts));
}

async function publish() {
  const made = JSON.parse(fs.readFileSync(path.join(OUT, 'made.json'), 'utf8')).at;
  const ref = encodeURIComponent(process.env.REF || '');
  const put = async (name, file) => {
    const body = fs.readFileSync(file);
    const out = await call('PUT', `/api/backup/latest?f=${encodeURIComponent(name)}&made=${made}&ref=${ref}`, body);
    console.log('Published', name, out.meta && out.meta.size);
  };
  await put('full', path.join(OUT, 'full-backup.json'));
  for (const f of fs.readdirSync(path.join(OUT, 'hospitals'))) {
    if (f.endsWith('.json')) await put('hosp:' + f.slice(0, -5), path.join(OUT, 'hospitals', f));
  }
}

(process.argv.includes('--publish') ? publish() : build()).catch(e => { console.error(e); process.exit(1); });
