/**
 * Resident profile helpers: suggestions from the roster and the ER scheduler, the yearly stage
 * level-up, and the duty-day clock (Iraq time, duty day starts at 08:00).
 */

import { nameKey, namesMatch, phoneKey } from './names.js';

export const BOARDS = ['arab', 'iraqi', 'other', 'none'];
const IRAQ_OFFSET_MS = 3 * 60 * 60 * 1000; // Iraq is UTC+3 all year

/** Today's duty day as YYYY-MM-DD (before 08:00 it is still yesterday's duty), Iraq time. */
export function dutyDayNow(now = Date.now()) {
  const d = new Date(now + IRAQ_OFFSET_MS);
  if (d.getUTCHours() < 8) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Stage level-up
// ---------------------------------------------------------------------------

let stageMonthCache = { at: 0, month: 10 };

/** Month (1-12) in which every resident moves up one stage; set by the owner, default October. */
export async function getStageMonth(env) {
  if (Date.now() - stageMonthCache.at < 60 * 1000) return stageMonthCache.month;
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'stage_month'").first();
  const m = Number(row && row.v);
  stageMonthCache = { at: Date.now(), month: m >= 1 && m <= 12 ? m : 10 };
  return stageMonthCache.month;
}

export async function setStageMonth(env, month) {
  await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('stage_month', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(month)).run();
  stageMonthCache = { at: Date.now(), month };
}

/**
 * Stage now = stage set at `stageRef` + one for every level-up day (1st of `month`, 00:00 Iraq
 * time) since then, never above `boardYears`.
 */
export function currentStage(stage, stageRef, boardYears, month, now = Date.now()) {
  if (stage === null || stage === undefined || stage === '') return null;
  let s = Number(stage);
  if (!stageRef) return s;
  const from = new Date(stageRef).getUTCFullYear() - 1;
  const to = new Date(now).getUTCFullYear() + 1;
  for (let y = from; y <= to; y++) {
    const day = Date.UTC(y, month - 1, 1) - IRAQ_OFFSET_MS;
    if (day > stageRef && day <= now) s++;
  }
  return boardYears ? Math.min(s, Number(boardYears)) : s;
}

export function profileComplete(row) {
  if (!row.board || !row.specialty) return false;
  if (row.board === 'none') return true;
  return row.stage !== null && row.stage !== undefined && !!row.board_years;
}

// ---------------------------------------------------------------------------
// Suggestions from the system's data
// ---------------------------------------------------------------------------

const ORDINALS = { 'الاولى': 1, 'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5, 'السادسة': 6, 'السابعة': 7 };

export function parseStage(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '-' || s === 'بدون') return null;
  if (s in ORDINALS) return ORDINALS[s];
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 8) return Math.round(n);
  return null;
}

export function parseBoard(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/arab/.test(s) || /عرب/.test(s)) return 'arab';
  if (/iraq/.test(s) || /عراق/.test(s)) return 'iraqi';
  if (s === 'none' || s === 'بدون') return 'none';
  return s ? 'other' : null;
}

/**
 * Best guess of a resident's profile: specialty from the hospital roster (Arabic name of the
 * specialty code), board / stage / sex from the ER scheduler's residents list. Missing pieces
 * stay null. Lookups are by phone where the ER list has one, otherwise by name.
 */
export async function suggestProfile(env, { name, hosp, residentId, phone }) {
  const key = nameKey(name);
  const [resRow, specs, er] = await env.DB.batch([
    env.DB.prepare("SELECT json_extract(data, '$.spec') AS spec, json_extract(data, '$.dept') AS dept FROM records WHERE coll = 'resident' AND id = ?").bind(residentId || ''),
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare(
      `SELECT json_extract(j.value, '$.name') AS name, json_extract(j.value, '$.sex') AS sex,
              json_extract(j.value, '$.specialty') AS specialty, json_extract(j.value, '$.board') AS board,
              json_extract(j.value, '$.stage') AS stage, json_extract(j.value, '$.phone') AS phone,
              json_extract(j.value, '$.hospitals') AS hospitals
         FROM records r, json_each(r.data, '$.residents') j
        WHERE r.coll = 'er' AND r.id = 'hosp_hub_emergency_state_v3'`
    ),
  ]);

  let specialties = [];
  try {
    const meta = JSON.parse(specs.results[0] ? specs.results[0].data : '{}');
    specialties = Array.isArray(meta) ? meta : (Array.isArray(meta.value) ? meta.value : []);
  } catch {}
  const byCode = code => specialties.find(s => s && s.id === code);
  const byEnglish = en => specialties.find(s => s && s.name_en && s.name_en.toLowerCase() === String(en || '').toLowerCase());

  const out = { board: null, specialty: null, stage: null, sex: null, source: [] };
  const code = resRow.results[0] && (resRow.results[0].spec || resRow.results[0].dept);
  if (code && byCode(code)) {
    out.specialty = byCode(code).name_ar || byCode(code).name_en;
    out.source.push('roster');
  }

  const pk = phoneKey(phone);
  const inHosp = r => { try { const h = JSON.parse(r.hospitals || '[]'); return !hosp || !h.length || h.includes(hosp); } catch { return true; } };
  const candidates = er.results || [];
  const match = (pk && candidates.find(r => phoneKey(r.phone) === pk))
    || candidates.find(r => nameKey(r.name) === key && inHosp(r))
    || candidates.find(r => namesMatch(name, r.name) && namesMatch(r.name, name) && inHosp(r));
  if (match) {
    out.board = parseBoard(match.board);
    out.stage = out.board === 'none' ? null : parseStage(match.stage);
    out.sex = match.sex === 'F' ? 'f' : match.sex === 'M' ? 'm' : null;
    if (!out.specialty && match.specialty) out.specialty = (byEnglish(match.specialty) || {}).name_ar || match.specialty;
    out.source.push('er');
  }
  return out;
}
