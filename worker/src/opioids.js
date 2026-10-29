/**
 * The opioids responsibility ("ذمة المخدرات") of a hospital's places (migration 0015).
 *
 * The owner and the hospital's admins create a duty: a place (named by them), the wards it covers,
 * the resident who holds its opioids (any resident of the hospital except rotators) and the opioids
 * handed over (name + ampoules). "Confirm and notify" makes it active: the holder is notified and gets
 * the tab in their profile. Later the admins edit it (place, wards, holder, new opioids), replenish an
 * opioid, withdraw ampoules or delete the duty.
 *
 * The hospital's rotators and the holder record each ampoule used on a patient (from the duty roster
 * page); the holder is notified of every use and when an opioid runs low or out.
 *
 * Each holder's time with a duty is a tenure: holders see only their own tenures' records (also of
 * earlier tenures of the same duty), the admins of the hospital and the owner see everything.
 */

import { json, readJson, plainText, overLimit } from './lib.js';
import { nameKey } from './names.js';
import { dutyDayNow } from './profile.js';
import { dispatchPush } from './accounts.js';
import { isRotatorSpec } from './exchspecs.js';
import { residentsOf } from './revcache.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 20, MAX_WARDS = 20, MAX_QTY = 500;
const parse = (t, d) => { try { const v = JSON.parse(t); return v == null ? d : v; } catch { return d; } };

const seesAll = auth => !!auth && (auth.r === 'owner' || (auth.r === 'admin' && (auth.h || []).includes('*')));
/** The owner, or an admin of `hosp`. */
const manages = (auth, hosp) => !!auth && (seesAll(auth) || (auth.r === 'admin' && (auth.h || []).includes(hosp)));
const manageScope = auth => seesAll(auth) ? null : (auth && auth.r === 'admin' ? (auth.h || []) : []);

export async function routeOpioids(path, method, request, env, auth, url, ctx) {
  if (!path.startsWith('/api/opioids')) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/opioids': return listForManager(env, auth, url);
    case 'GET /api/opioids/residents': return residentChoices(env, auth, url);
    case 'POST /api/opioids/duty': return saveDuty(request, env, auth, ctx);
    case 'POST /api/opioids/confirm': return confirmDuty(request, env, auth, ctx);
    case 'POST /api/opioids/stock': return changeStock(request, env, auth, ctx);
    case 'POST /api/opioids/delete': return deleteDuty(request, env, auth, ctx);
    case 'GET /api/opioids/mine': return mine(env, auth);
    case 'GET /api/opioids/targets': return targets(env, auth, url);
    case 'POST /api/opioids/use': return recordUse(request, env, auth, ctx);
    case 'POST /api/opioids/void': return voidUse(request, env, auth, ctx);
    case 'POST /api/opioids/move': return editMove(request, env, auth);
    case 'POST /api/opioids/handoff': return handOff(request, env, auth, ctx);
    case 'GET /api/opioids/history': return history(env, auth, url);
    default: return json({ error: 'not_found' }, 404);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What is left of each item of these duties: Map item id -> left. */
async function leftOf(env, dutyIds) {
  if (!dutyIds.length) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT item_id, SUM(CASE WHEN kind = 'issue' THEN qty WHEN kind IN ('use', 'withdraw') AND voided_at IS NULL THEN -qty ELSE 0 END) AS left
       FROM opioid_moves WHERE duty_id IN (SELECT value FROM json_each(?1)) GROUP BY item_id`
  ).bind(JSON.stringify(dutyIds)).all();
  return new Map((results || []).map(r => [r.item_id, r.left || 0]));
}

const moveView = m => ({
  id: m.id, duty: m.duty_id, item: m.item_id, itemName: m.item_name || '', tenure: m.tenure_id, kind: m.kind, qty: m.qty,
  patient: m.patient || '', patientNo: m.patient_no || '', diagnosis: m.diagnosis || '', sex: m.sex || '', age: m.age, ward: m.ward || '', date: m.use_date || '', note: m.note || '',
  by: m.by_name || '', byRole: m.by_role || '', at: m.created_at, voided: !!m.voided_at, voidReason: m.void_reason || '', voidedBy: m.voided_by || '',
  edited: m.edited_at || null, editedBy: m.edited_by || '',
  holder: m.holder_name || '',
});
const MOVE_SELECT = `SELECT m.*, i.name AS item_name, t.holder_name FROM opioid_moves m
  JOIN opioid_items i ON i.id = m.item_id LEFT JOIN opioid_tenures t ON t.id = m.tenure_id`;

/** Duties with their items (and what is left), current tenure and the assigned holder. */
async function dutiesView(env, rows) {
  if (!rows.length) return [];
  const ids = rows.map(d => d.id);
  const [items, tenures] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM opioid_items WHERE duty_id IN (SELECT value FROM json_each(?1)) ORDER BY id').bind(JSON.stringify(ids)),
    env.DB.prepare('SELECT * FROM opioid_tenures WHERE duty_id IN (SELECT value FROM json_each(?1)) ORDER BY started_at').bind(JSON.stringify(ids)),
  ]);
  const left = await leftOf(env, ids);
  const keys = [...new Set([...rows.map(d => d.next_key), ...(tenures.results || []).map(t => t.holder_key)].filter(Boolean))];
  const resIds = [...new Set([...rows.map(d => d.next_res), ...(tenures.results || []).map(t => t.holder_res)].filter(Boolean))];
  const has = await accountsOf(env, keys, resIds);
  return rows.map(d => {
    const ts = (tenures.results || []).filter(t => t.duty_id === d.id);
    const cur = ts.find(t => !t.ended_at) || null;
    return {
      id: d.id, hosp: d.hosp, place: d.place, wards: parse(d.wards, []), status: d.status,
      holder: cur ? { tenure: cur.id, res: cur.holder_res, key: cur.holder_key, name: cur.holder_name, since: cur.started_at, account: has(cur.holder_key, cur.holder_res) } : null,
      next: d.next_key ? { res: d.next_res, key: d.next_key, name: d.next_name, account: has(d.next_key, d.next_res) } : null,
      pending: d.status === 'draft' || (!!d.next_key && (!cur || cur.holder_key !== d.next_key)),
      tenures: ts.map(t => ({ id: t.id, name: t.holder_name, from: t.started_at, to: t.ended_at })),
      items: (items.results || []).filter(i => i.duty_id === d.id && i.active).map(i => ({ id: i.id, name: i.name, low: i.low_at, left: left.get(i.id) || 0 })),
      updated: d.updated_at,
    };
  });
}

/** has(key, res): does that resident have an active (non-rotator) account? */
async function accountsOf(env, keys, resIds) {
  if (!keys.length && !resIds.length) return () => false;
  // Two lookups through the name and resident indexes (one query with OR read every account).
  const { results } = await env.DB.prepare(
    `SELECT name_key, resident_id FROM accounts WHERE name_key IN (SELECT value FROM json_each(?1)) AND status = 'active' AND role <> 'rotator'
     UNION ALL
     SELECT name_key, resident_id FROM accounts WHERE resident_id IN (SELECT value FROM json_each(?2))
        AND status IN ('pending', 'active') AND status = 'active' AND role <> 'rotator'`
  ).bind(JSON.stringify(keys), JSON.stringify(resIds)).all();
  const k = new Set((results || []).map(r => r.name_key)), r = new Set((results || []).map(x => x.resident_id).filter(Boolean));
  return (key, res) => k.has(key) || (!!res && r.has(res));
}

/** GET ?h=: the duties of the hospitals the owner / admin manages (and their records). */
async function listForManager(env, auth, url) {
  const scope = manageScope(auth);
  if (scope && !scope.length) return json({ error: 'forbidden' }, 403);
  const h = url.searchParams.get('h');
  if (h && !manages(auth, h)) return json({ error: 'forbidden' }, 403);
  const hosps = h ? [h] : scope;
  const { results } = await env.DB.prepare(
    `SELECT * FROM opioid_duties WHERE status <> 'deleted' ${hosps ? 'AND hosp IN (SELECT value FROM json_each(?1))' : ''} ORDER BY hosp, created_at`
  ).bind(...(hosps ? [JSON.stringify(hosps)] : [])).all();
  const duties = await dutiesView(env, results || []);
  const ids = duties.map(d => d.id);
  const { results: moves } = ids.length ? await env.DB.prepare(
    `${MOVE_SELECT} WHERE m.duty_id IN (SELECT value FROM json_each(?1)) ORDER BY m.created_at DESC LIMIT 400`
  ).bind(JSON.stringify(ids)).all() : { results: [] };
  return json({ ok: true, duties, moves: (moves || []).map(moveView), owner: auth.r === 'owner', scope: scope || ['*'] });
}

/** GET ?h=&q=: residents of the hospital who may hold a duty (not rotators), closest names first. */
async function residentChoices(env, auth, url) {
  const hosp = String(url.searchParams.get('h') || '');
  if (!HOSP_RE.test(hosp) || !manages(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const q = nameKey(String(url.searchParams.get('q') || '').slice(0, 60));
  const residents = await residentsOf(env, hosp);
  const [rot, meta, hospital] = await env.DB.batch([
    env.DB.prepare("SELECT resident_id, name_key FROM accounts WHERE role = 'rotator'"),
    env.DB.prepare("SELECT data FROM records WHERE coll = 'meta' AND id = 'globalSpecialties'"),
    env.DB.prepare("SELECT json_extract(data, '$.specialties') AS specs FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp),
  ]);
  const store = (parse(meta.results[0] && meta.results[0].data, {}) || {}).value || [];
  const own = parse(hospital.results[0] && hospital.results[0].specs, []) || [];
  const specs = [...store, ...own];
  const rotIds = new Set((rot.results || []).map(r => r.resident_id).filter(Boolean));
  const rotKeys = new Set((rot.results || []).map(r => r.name_key).filter(Boolean));
  const list = residents
    .filter(r => r.name && r.active !== 0 && r.active !== false && !rotIds.has(r.id) && !rotKeys.has(nameKey(r.name)) && !(r.dept && isRotatorSpec(specs, r.dept)))
    .map(r => ({ res: r.id, name: r.name, key: nameKey(r.name) }));
  const has = await accountsOf(env, list.map(r => r.key), list.map(r => r.res));
  list.forEach(r => { r.account = has(r.key, r.res); });
  // Closest first: starts with what was typed, then contains it, then shares its words.
  const score = r => !q ? 0 : r.key.startsWith(q) ? 3 : r.key.includes(q) ? 2 : q.split(' ').filter(w => w && r.key.includes(w)).length ? 1 : -1;
  const out = list.map(r => [score(r), r]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'ar')).slice(0, 12).map(([, r]) => r);
  return json({ ok: true, residents: out });
}

/** GET: the signed-in resident's duties as holder (current ones and earlier tenures), only their records. */
async function mine(env, auth) {
  if (!auth.a || auth.r === 'rotator') return json({ ok: true, duties: [], moves: [] });
  const key = await accountKey(env, auth);
  if (!key) return json({ ok: true, duties: [], moves: [] });
  const { results: tens } = await env.DB.prepare('SELECT * FROM opioid_tenures WHERE holder_key = ? ORDER BY started_at DESC').bind(key).all();
  if (!(tens || []).length) return json({ ok: true, duties: [], moves: [] });
  const dutyIds = [...new Set(tens.map(t => t.duty_id))];
  const { results: drows } = await env.DB.prepare('SELECT * FROM opioid_duties WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(dutyIds)).all();
  const all = await dutiesView(env, drows || []);
  // Current: duties the resident holds now (active). Earlier ones: their places, without stock.
  const duties = all.map(d => {
    const holding = d.status === 'active' && d.holder && d.holder.key === key;
    return { ...d, holding, items: holding ? d.items : [], tenures: d.tenures.filter(t => tens.some(x => x.id === t.id)), next: undefined };
  });
  const { results: moves } = await env.DB.prepare(
    `${MOVE_SELECT} WHERE m.tenure_id IN (SELECT value FROM json_each(?1)) ORDER BY m.created_at DESC LIMIT 1000`
  ).bind(JSON.stringify(tens.map(t => t.id))).all();
  return json({ ok: true, duties, moves: (moves || []).map(moveView), today: dutyDayNow() });
}

/** GET ?h=: the duties of the hospital this account may record uses in (rotators of the hospital, holders, owner). */
async function targets(env, auth, url) {
  const hosp = String(url.searchParams.get('h') || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  const { results } = await env.DB.prepare("SELECT * FROM opioid_duties WHERE hosp = ? AND status = 'active' ORDER BY created_at").bind(hosp).all();
  let duties = await dutiesView(env, results || []);
  if (auth.r === 'owner') return json({ ok: true, duties: duties.map(targetView), as: 'owner' });
  if (!auth.a) return json({ ok: true, duties: [] });
  if (auth.r === 'rotator') return json({ ok: true, duties: auth.hosp === hosp ? duties.map(targetView) : [], as: 'rotator' });
  const key = await accountKey(env, auth);
  duties = duties.filter(d => d.holder && key && d.holder.key === key);
  return json({ ok: true, duties: duties.map(targetView), as: 'holder' });
}
const targetView = d => ({ id: d.id, place: d.place, wards: d.wards, holder: d.holder ? d.holder.name : '', items: d.items.map(i => ({ id: i.id, name: i.name, left: i.left, low: i.low })) });

async function accountKey(env, auth) {
  const row = await env.DB.prepare('SELECT name_key, role FROM accounts WHERE id = ?').bind(auth.a).first();
  return row && row.role !== 'rotator' ? row.name_key : null;
}

// ---------------------------------------------------------------------------
// The admins: create / edit, confirm and notify, stock, delete
// ---------------------------------------------------------------------------

/** The patient's name, his father's and grandfather's (at least three words). */
const threeNames = n => String(n || '').trim().split(/\s+/).filter(w => w.replace(/[^\p{L}]/gu, '').length >= 2).length >= 3;
const cleanWards = w => [...new Set((Array.isArray(w) ? w : []).map(x => plainText(x, 40)).filter(Boolean))].slice(0, MAX_WARDS);
const qtyOf = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 && n <= MAX_QTY ? n : 0; };

/**
 * Body: { id?, hosp, place, wards[], holder: { res, name }, items: [{ id?, name, qty?, low? }] }.
 * New items need their ampoules (qty); existing items keep theirs (stock changes go through /stock).
 * A draft's items can still be changed freely (their first issue is not confirmed yet).
 */
async function saveDuty(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const now = Date.now();
  let duty = null;
  if (body.id) {
    duty = await env.DB.prepare("SELECT * FROM opioid_duties WHERE id = ? AND status <> 'deleted'").bind(Number(body.id)).first();
    if (!duty) return json({ error: 'not_found' }, 404);
  }
  const hosp = duty ? duty.hosp : String(body.hosp || '');
  if (!HOSP_RE.test(hosp)) return json({ error: 'bad_request' }, 400);
  if (!manages(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const place = plainText(body.place, 60);
  const wards = cleanWards(body.wards);
  const holderName = plainText(body.holder && body.holder.name, 80);
  const holderRes = body.holder && body.holder.res ? String(body.holder.res).slice(0, 64) : null;
  if (!place) return json({ error: 'place_required' }, 400);
  if (!wards.length) return json({ error: 'wards_required' }, 400);
  if (!holderName || !nameKey(holderName)) return json({ error: 'holder_required' }, 400);
  // The holder must be one of the hospital's residents (and not a rotator).
  const choices = await (await residentChoices(env, auth, new URL(`https://x/?h=${encodeURIComponent(hosp)}&q=${encodeURIComponent(holderName)}`))).json();
  const pick = (choices.residents || []).find(r => (holderRes && r.res === holderRes) || r.key === nameKey(holderName));
  if (!pick) return json({ error: 'holder_not_resident' }, 400);

  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS).map(i => ({
    id: i && i.id ? Number(i.id) : null, name: plainText(i && i.name, 60), qty: qtyOf(i && i.qty), low: Math.max(0, Math.min(100, Math.floor(Number(i && i.low)) || 2)),
  })).filter(i => i.name);
  if (!items.length) return json({ error: 'items_required' }, 400);
  const draft = !duty || duty.status === 'draft';
  if (items.some(i => !i.id && !i.qty)) return json({ error: 'qty_required' }, 400);
  if (draft && items.some(i => !i.qty)) return json({ error: 'qty_required' }, 400);

  const who = [auth.a || auth.r, auth.name || (auth.r === 'owner' ? 'المالك' : 'الإدارة'), auth.r];
  let id = duty && duty.id;
  if (!duty) {
    const ins = await env.DB.prepare(
      `INSERT INTO opioid_duties (hosp, place, wards, status, next_res, next_key, next_name, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?8) RETURNING id`
    ).bind(hosp, place, JSON.stringify(wards), pick.res, pick.key, pick.name, who[0], now).first();
    id = ins.id;
  } else {
    await env.DB.prepare('UPDATE opioid_duties SET place = ?2, wards = ?3, next_res = ?4, next_key = ?5, next_name = ?6, updated_at = ?7 WHERE id = ?1')
      .bind(id, place, JSON.stringify(wards), pick.res, pick.key, pick.name, now).run();
  }
  // Items: rename / threshold for existing ones; new ones with their first issue.
  const { results: had } = await env.DB.prepare('SELECT * FROM opioid_items WHERE duty_id = ? AND active = 1').bind(id).all();
  const tenure = draft ? null : await env.DB.prepare('SELECT id FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(id).first();
  const stmts = [];
  for (const i of items) {
    const old = i.id && (had || []).find(x => x.id === i.id);
    if (old) {
      stmts.push(env.DB.prepare('UPDATE opioid_items SET name = ?2, low_at = ?3 WHERE id = ?1').bind(old.id, i.name, i.low));
      if (draft) stmts.push(env.DB.prepare("UPDATE opioid_moves SET qty = ?2 WHERE item_id = ?1 AND kind = 'issue' AND tenure_id IS NULL").bind(old.id, i.qty));
    } else {
      const it = await env.DB.prepare('INSERT INTO opioid_items (duty_id, name, low_at, active, created_at) VALUES (?1, ?2, ?3, 1, ?4) RETURNING id').bind(id, i.name, i.low, now).first();
      stmts.push(env.DB.prepare(
        `INSERT INTO opioid_moves (duty_id, item_id, tenure_id, kind, qty, note, by_id, by_name, by_role, created_at) VALUES (?1, ?2, ?3, 'issue', ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(id, it.id, tenure ? tenure.id : null, i.qty, draft ? 'الاستلام الأول' : 'مادة جديدة', ...who, now));
    }
  }
  // Items left out: removed (a draft's at once; an active duty's only when none are left).
  const keep = new Set(items.filter(i => i.id).map(i => i.id));
  const left = await leftOf(env, [id]);
  for (const old of had || []) {
    if (keep.has(old.id)) continue;
    if (!draft && (left.get(old.id) || 0) > 0) return json({ error: 'item_not_empty', item: old.name }, 409);
    stmts.push(env.DB.prepare('UPDATE opioid_items SET active = 0 WHERE id = ?').bind(old.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  // An active duty given to another resident: the change applies now and they are notified.
  let applied = null;
  if (duty && duty.status === 'active') {
    const cur = await env.DB.prepare('SELECT holder_key FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(id).first();
    if (!cur || cur.holder_key !== pick.key) applied = await applyHolder(env, await env.DB.prepare('SELECT * FROM opioid_duties WHERE id = ?').bind(id).first(), auth, ctx);
  }
  const [view] = await dutiesView(env, [await env.DB.prepare('SELECT * FROM opioid_duties WHERE id = ?').bind(id).first()]);
  return json({ ok: true, duty: view, applied });
}

/** The assigned holder's accounts (by resident record or name), excluding rotators. */
function holderAccounts(env, res, key) {
  return env.DB.prepare(
    "SELECT id FROM accounts WHERE status = 'active' AND role <> 'rotator' AND (name_key = ?1 OR (?2 IS NOT NULL AND resident_id = ?2))"
  ).bind(key, res || null).all();
}
function notifyAccounts(env, ids, gkey, type, data, now) {
  if (!ids.length) return null;
  return env.DB.prepare(
    `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
     SELECT value, ?2, ?3, ?4, ?5, 0 FROM json_each(?1) WHERE true
     ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
     RETURNING account_id, type, data, gkey, ts`
  ).bind(JSON.stringify(ids), gkey, type, JSON.stringify(data), now).run();
}
const hospitalName = async (env, hosp) => {
  const r = await env.DB.prepare("SELECT COALESCE(json_extract(data, '$.name_ar'), json_extract(data, '$.hospitalName')) AS n FROM records WHERE coll = 'hospital' AND id = ?").bind(hosp).first();
  return (r && r.n) || hosp;
};

/** Body: { id }. Applies the assigned holder (a new tenure; the stock goes with the duty) and notifies them. */
async function confirmDuty(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const duty = await env.DB.prepare("SELECT * FROM opioid_duties WHERE id = ? AND status <> 'deleted'").bind(Number(body.id)).first();
  if (!duty) return json({ error: 'not_found' }, 404);
  if (!manages(auth, duty.hosp)) return json({ error: 'forbidden' }, 403);
  if (!duty.next_key) return json({ error: 'holder_required' }, 400);
  return json({ ok: true, ...(await applyHolder(env, duty, auth, ctx)) });
}

/**
 * The assigned holder takes over (a new tenure; the stock stays with the duty and the new holder's
 * log starts with what they received), the duty becomes active, and the new holder is notified (the
 * previous one too: the duty left their hands).
 */
async function applyHolder(env, duty, auth, ctx) {
  const now = Date.now();
  const cur = await env.DB.prepare('SELECT * FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(duty.id).first();
  const changed = !cur || cur.holder_key !== duty.next_key;
  let tenureId = cur && cur.id;
  if (changed) {
    const stmts = [];
    if (cur) stmts.push(env.DB.prepare('UPDATE opioid_tenures SET ended_at = ?2 WHERE id = ?1').bind(cur.id, now));
    await env.DB.batch(stmts.length ? stmts : [env.DB.prepare('SELECT 1')]);
    const t = await env.DB.prepare(
      'INSERT INTO opioid_tenures (duty_id, holder_res, holder_key, holder_name, started_at, started_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id'
    ).bind(duty.id, duty.next_res, duty.next_key, duty.next_name, now, auth.a || auth.r).first();
    tenureId = t.id;
    // The first issue belongs to the first holder; a new holder receives what is left (a handover record).
    const who = [auth.a || auth.r, auth.name || (auth.r === 'owner' ? 'المالك' : 'الإدارة'), auth.r];
    const fin = [env.DB.prepare('UPDATE opioid_moves SET tenure_id = ?2 WHERE duty_id = ?1 AND tenure_id IS NULL').bind(duty.id, tenureId)];
    if (cur) {
      const left = await leftOf(env, [duty.id]);
      const { results: items } = await env.DB.prepare('SELECT id FROM opioid_items WHERE duty_id = ? AND active = 1').bind(duty.id).all();
      for (const i of items || []) {
        fin.push(env.DB.prepare(
          `INSERT INTO opioid_moves (duty_id, item_id, tenure_id, kind, qty, note, by_id, by_name, by_role, created_at) VALUES (?1, ?2, ?3, 'handover', ?4, ?5, ?6, ?7, ?8, ?9)`
        ).bind(duty.id, i.id, tenureId, left.get(i.id) || 0, `استلام من ${cur.holder_name}`, ...who, now));
      }
    }
    await env.DB.batch(fin);
  }
  await env.DB.prepare("UPDATE opioid_duties SET status = 'active', updated_at = ?2 WHERE id = ?1").bind(duty.id, now).run();
  const { results: accs } = await holderAccounts(env, duty.next_res, duty.next_key);
  const ids = (accs || []).map(a => a.id);
  const hospName = await hospitalName(env, duty.hosp);
  const stmts = [];
  const res = await notifyAccounts(env, ids, `opi-assign:${duty.id}:${tenureId}`, 'opioid_assigned',
    { duty: duty.id, place: duty.place, hosp: duty.hosp, hospName, by: auth.name || '', from: cur && changed ? cur.holder_name : '' }, now);
  if (res) stmts.push(res);
  if (cur && changed) {
    const { results: old } = await holderAccounts(env, cur.holder_res, cur.holder_key);
    const out = await notifyAccounts(env, (old || []).map(a => a.id), `opi-off:${duty.id}:${cur.id}`, 'opioid_handed_off',
      { duty: duty.id, place: duty.place, hosp: duty.hosp, hospName, to: duty.next_name, by: auth.name || '' }, now);
    if (out) stmts.push(out);
  }
  if (stmts.length) dispatchPush(env, ctx, ...stmts);
  return { notified: ids.length, changed, tenure: tenureId, holderAccount: ids.length > 0 };
}

/** Body: { id, holder: { res, name } }. Hand the duty to the next resident now (they are notified). */
async function handOff(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const duty = await env.DB.prepare("SELECT * FROM opioid_duties WHERE id = ? AND status <> 'deleted'").bind(Number(body.id)).first();
  if (!duty) return json({ error: 'not_found' }, 404);
  if (!manages(auth, duty.hosp)) return json({ error: 'forbidden' }, 403);
  const name = plainText(body.holder && body.holder.name, 80);
  const res = body.holder && body.holder.res ? String(body.holder.res).slice(0, 64) : null;
  const choices = await (await residentChoices(env, auth, new URL(`https://x/?h=${encodeURIComponent(duty.hosp)}&q=${encodeURIComponent(name)}`))).json();
  const pick = (choices.residents || []).find(r => (res && r.res === res) || r.key === nameKey(name));
  if (!pick) return json({ error: 'holder_not_resident' }, 400);
  const cur = await env.DB.prepare('SELECT holder_key FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(duty.id).first();
  if (cur && cur.holder_key === pick.key) return json({ error: 'same_holder' }, 400);
  await env.DB.prepare('UPDATE opioid_duties SET next_res = ?2, next_key = ?3, next_name = ?4, updated_at = ?5 WHERE id = ?1')
    .bind(duty.id, pick.res, pick.key, pick.name, Date.now()).run();
  const fresh = await env.DB.prepare('SELECT * FROM opioid_duties WHERE id = ?').bind(duty.id).first();
  return json({ ok: true, ...(await applyHolder(env, fresh, auth, ctx)) });
}

/**
 * GET ?h=<hospital>: every holder's period of every duty of the hospital, with all of its records;
 * GET ?id=<duty>: the same for one duty. The owner and the hospital's admins.
 */
async function history(env, auth, url) {
  const h = url.searchParams.get('h');
  if (h) {
    if (!HOSP_RE.test(h) || !manages(auth, h)) return json({ error: 'forbidden' }, 403);
    const { results: duties } = await env.DB.prepare("SELECT id, place, wards FROM opioid_duties WHERE hosp = ? AND status <> 'deleted'").bind(h).all();
    const ids = (duties || []).map(d => d.id);
    if (!ids.length) return json({ ok: true, hosp: h, duties: [], tenures: [] });
    const [tens, moves] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM opioid_tenures WHERE duty_id IN (SELECT value FROM json_each(?1)) ORDER BY started_at').bind(JSON.stringify(ids)),
      env.DB.prepare(`${MOVE_SELECT} WHERE m.duty_id IN (SELECT value FROM json_each(?1)) ORDER BY m.created_at`).bind(JSON.stringify(ids)),
    ]);
    const all = (moves.results || []).map(moveView);
    const place = new Map(duties.map(d => [d.id, d.place]));
    return json({ ok: true, hosp: h, duties: duties.map(d => ({ id: d.id, place: d.place, wards: parse(d.wards, []) })),
      tenures: (tens.results || []).map(t => ({ id: t.id, duty: t.duty_id, place: place.get(t.duty_id) || '', name: t.holder_name, from: t.started_at, to: t.ended_at, moves: all.filter(m => m.tenure === t.id) })) });
  }
  const duty = await env.DB.prepare("SELECT * FROM opioid_duties WHERE id = ? AND status <> 'deleted'").bind(Number(url.searchParams.get('id'))).first();
  if (!duty) return json({ error: 'not_found' }, 404);
  if (!manages(auth, duty.hosp)) return json({ error: 'forbidden' }, 403);
  const [tens, moves] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM opioid_tenures WHERE duty_id = ? ORDER BY started_at').bind(duty.id),
    env.DB.prepare(`${MOVE_SELECT} WHERE m.duty_id = ? ORDER BY m.created_at`).bind(duty.id),
  ]);
  const all = (moves.results || []).map(moveView);
  return json({ ok: true, duty: { id: duty.id, place: duty.place, hosp: duty.hosp, wards: parse(duty.wards, []) },
    tenures: (tens.results || []).map(t => ({ id: t.id, name: t.holder_name, from: t.started_at, to: t.ended_at, moves: all.filter(m => m.tenure === t.id) })),
    unassigned: all.filter(m => !m.tenure) });
}

/** Body: { item, qty, kind: 'issue' | 'withdraw', note }. Replenish an opioid, or take ampoules back. */
async function changeStock(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const item = await env.DB.prepare('SELECT i.*, d.hosp, d.status, d.place FROM opioid_items i JOIN opioid_duties d ON d.id = i.duty_id WHERE i.id = ? AND i.active = 1').bind(Number(body.item)).first();
  if (!item || item.status === 'deleted') return json({ error: 'not_found' }, 404);
  const qty = qtyOf(body.qty);
  const kind = body.kind === 'withdraw' ? 'withdraw' : 'issue';
  // The holder replenishes their own stock (only add); the admins of the hospital and the owner are told.
  const holderNow = item.status === 'active' && auth.a ? await env.DB.prepare('SELECT holder_key FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(item.duty_id).first() : null;
  const isHolder = !!holderNow && (await accountKey(env, auth)) === holderNow.holder_key;
  if (!manages(auth, item.hosp) && (!isHolder || kind !== 'issue')) return json({ error: 'forbidden' }, 403);
  const byHolder = isHolder && kind === 'issue';
  if (!qty) return json({ error: 'qty_required' }, 400);
  const left = (await leftOf(env, [item.duty_id])).get(item.id) || 0;
  if (kind === 'withdraw' && qty > left) return json({ error: 'not_enough', left }, 409);
  const tenure = await env.DB.prepare('SELECT id, holder_key, holder_res FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(item.duty_id).first();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO opioid_moves (duty_id, item_id, tenure_id, kind, qty, note, by_id, by_name, by_role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(item.duty_id, item.id, tenure ? tenure.id : null, kind, qty, plainText(body.note, 120) || null, auth.a || auth.r, auth.name || (auth.r === 'owner' ? 'المالك' : 'الإدارة'), auth.r, now).run();
  const after = kind === 'issue' ? left + qty : left - qty;
  if (byHolder) {
    // Every owner and every admin of the hospital, except the holder themselves.
    const res = await env.DB.prepare(
      `INSERT INTO notifications (account_id, gkey, type, data, ts, seen)
       SELECT id, ?1, 'opioid_replenished', ?2, ?3, 0 FROM accounts
        WHERE status = 'active' AND id <> ?5 AND (role = 'owner' OR (role = 'admin' AND EXISTS (
              SELECT 1 FROM json_each(accounts.hospitals) WHERE value IN (?4, '*'))))
       ON CONFLICT (account_id, gkey) DO UPDATE SET data = excluded.data, ts = excluded.ts, seen = 0
       RETURNING account_id, type, data, gkey, ts`
    ).bind(`opi-refill:${item.id}:${now}`, JSON.stringify({ duty: item.duty_id, place: item.place, item: item.name, qty, left: after, by: auth.name || '', hosp: item.hosp }), now, item.hosp, auth.a).run();
    dispatchPush(env, ctx, res);
    return json({ ok: true, left: after, notified: (res.results || []).length });
  }
  if (tenure && item.status === 'active') {
    const { results: accs } = await holderAccounts(env, tenure.holder_res, tenure.holder_key);
    const res = await notifyAccounts(env, (accs || []).map(a => a.id), `opi-stock:${item.id}`, 'opioid_stock',
      { duty: item.duty_id, place: item.place, item: item.name, kind, qty, left: after }, now);
    if (res) dispatchPush(env, ctx, res);
  }
  return json({ ok: true, left: after });
}

/** Body: { id, confirm: true }. The duty and every record of it are deleted (the page asks for a typed code first). */
async function deleteDuty(request, env, auth) {
  const body = await readJson(request) || {};
  const duty = await env.DB.prepare('SELECT * FROM opioid_duties WHERE id = ?').bind(Number(body.id)).first();
  if (!duty) return json({ error: 'not_found' }, 404);
  if (!manages(auth, duty.hosp)) return json({ error: 'forbidden' }, 403);
  if (body.confirm !== true) return json({ error: 'confirm_required' }, 400);
  const counts = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM opioid_moves WHERE duty_id = ?1) AS moves, (SELECT COUNT(*) FROM opioid_tenures WHERE duty_id = ?1) AS tenures').bind(duty.id).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM opioid_moves WHERE duty_id = ?').bind(duty.id),
    env.DB.prepare('DELETE FROM opioid_items WHERE duty_id = ?').bind(duty.id),
    env.DB.prepare('DELETE FROM opioid_tenures WHERE duty_id = ?').bind(duty.id),
    env.DB.prepare('DELETE FROM opioid_duties WHERE id = ?').bind(duty.id),
  ]);
  return json({ ok: true, deleted: counts });
}

// ---------------------------------------------------------------------------
// Recording a use (rotators of the hospital, the holder, the owner)
// ---------------------------------------------------------------------------

/** Body: { duty, item, qty, patient, patientNo?, diagnosis, sex, age, ward, date }. */
async function recordUse(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const duty = await env.DB.prepare("SELECT * FROM opioid_duties WHERE id = ? AND status = 'active'").bind(Number(body.duty)).first();
  if (!duty) return json({ error: 'not_found' }, 404);
  const tenure = await env.DB.prepare('SELECT * FROM opioid_tenures WHERE duty_id = ? AND ended_at IS NULL').bind(duty.id).first();
  if (!tenure) return json({ error: 'not_found' }, 404);
  // Who may: the owner, the hospital's rotators, the holder.
  let as = null;
  if (auth.r === 'owner') as = 'owner';
  else if (auth.a && auth.r === 'rotator' && auth.hosp === duty.hosp) as = 'rotator';
  else if (auth.a && (await accountKey(env, auth)) === tenure.holder_key) as = 'holder';
  if (!as) return json({ error: 'forbidden' }, 403);
  if (auth.a && await overLimit(env, 'opiuse:' + auth.a, 40)) return json({ error: 'rate_limited' }, 429);

  const item = await env.DB.prepare('SELECT * FROM opioid_items WHERE id = ? AND duty_id = ? AND active = 1').bind(Number(body.item), duty.id).first();
  if (!item) return json({ error: 'item_not_found' }, 404);
  const qty = Math.max(1, Math.min(10, Math.floor(Number(body.qty)) || 1));
  const patient = plainText(body.patient, 80);
  const patientNo = plainText(body.patientNo, 30) || null;
  const diagnosis = plainText(body.diagnosis, 120);
  const sex = body.sex === 'f' ? 'f' : body.sex === 'm' ? 'm' : '';
  const age = Math.floor(Number(body.age));
  const wards = parse(duty.wards, []);
  const ward = plainText(body.ward, 40);
  let date = String(body.date || dutyDayNow());
  if (!patient) return json({ error: 'patient_required' }, 400);
  if (!threeNames(patient)) return json({ error: 'patient_three_names' }, 400);
  if (!diagnosis) return json({ error: 'diagnosis_required' }, 400);
  if (!sex) return json({ error: 'sex_required' }, 400);
  if (body.age === '' || body.age == null || !Number.isFinite(age) || age < 0 || age > 120) return json({ error: 'age_required' }, 400);
  if (!wards.includes(ward)) return json({ error: 'ward_required' }, 400);
  if (!body.date) return json({ error: 'bad_date' }, 400);
  if (!DATE_RE.test(date) || date > dutyDayNow()) return json({ error: 'bad_date' }, 400);

  const left = (await leftOf(env, [duty.id])).get(item.id) || 0;
  if (qty > left) return json({ error: 'not_enough', left }, 409);
  const now = Date.now();
  const byName = auth.name || (as === 'owner' ? 'المالك' : '');
  const ins = await env.DB.prepare(
    `INSERT INTO opioid_moves (duty_id, item_id, tenure_id, kind, qty, patient, sex, age, ward, use_date, by_id, by_name, by_role, created_at, patient_no, diagnosis)
     VALUES (?1, ?2, ?3, 'use', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) RETURNING id`
  ).bind(duty.id, item.id, tenure.id, qty, patient, sex, age, ward, date, auth.a || auth.r, byName, as, now, patientNo, diagnosis).first();
  const after = left - qty;

  // The holder: every use (unless they recorded it themselves), and running low / out.
  if (as !== 'holder') {
    const { results: accs } = await holderAccounts(env, tenure.holder_res, tenure.holder_key);
    const ids = (accs || []).map(a => a.id).filter(id => id !== auth.a);
    const stmts = [];
    const base = { duty: duty.id, place: duty.place, item: item.name, left: after };
    const used = await notifyAccounts(env, ids, `opi-use:${ins.id}`, 'opioid_used', { ...base, qty, ward, by: byName, patient }, now);
    if (used) stmts.push(used);
    if (after <= item.low_at) {
      const low = await notifyAccounts(env, ids, `opi-low:${item.id}`, after === 0 ? 'opioid_empty' : 'opioid_low', { ...base, low: item.low_at }, now + 1);
      if (low) stmts.push(low);
    }
    if (stmts.length) dispatchPush(env, ctx, ...stmts);
  } else if (after <= item.low_at) {
    const { results: accs } = await holderAccounts(env, tenure.holder_res, tenure.holder_key);
    const low = await notifyAccounts(env, (accs || []).map(a => a.id), `opi-low:${item.id}`, after === 0 ? 'opioid_empty' : 'opioid_low',
      { duty: duty.id, place: duty.place, item: item.name, left: after, low: item.low_at }, now + 1);
    if (low) dispatchPush(env, ctx, low);
  }
  return json({ ok: true, id: ins.id, left: after, low: after <= item.low_at });
}

/**
 * Body: { id, action: 'edit' | 'delete', patient, patientNo, diagnosis, sex, age, ward, date, qty, note, reason }.
 * The owner, the hospital's admins and the holder of the entry's tenure edit or delete a log entry
 * (a deleted entry stays visible, crossed out, with who deleted it; a handover cannot change). The
 * stock must stay at zero or more.
 */
async function editMove(request, env, auth) {
  const body = await readJson(request) || {};
  const m = await env.DB.prepare(
    `SELECT m.*, d.hosp, d.wards, t.holder_key FROM opioid_moves m JOIN opioid_duties d ON d.id = m.duty_id
       LEFT JOIN opioid_tenures t ON t.id = m.tenure_id WHERE m.id = ?`
  ).bind(Number(body.id)).first();
  if (!m) return json({ error: 'not_found' }, 404);
  if (m.kind === 'handover') return json({ error: 'not_editable' }, 400);
  if (m.voided_at) return json({ error: 'deleted' }, 409);
  const allowed = manages(auth, m.hosp) || (!!auth.a && !!m.holder_key && (await accountKey(env, auth)) === m.holder_key);
  if (!allowed) return json({ error: 'forbidden' }, 403);
  const who = auth.name || (auth.r === 'owner' ? 'المالك' : 'الإدارة');
  const left = (await leftOf(env, [m.duty_id])).get(m.item_id) || 0;
  // What the stock would be after: an issue counts +, a use / withdrawal counts −.
  const sign = m.kind === 'issue' ? 1 : -1;
  if (body.action === 'delete') {
    if (left - sign * m.qty < 0) return json({ error: 'would_go_negative', left }, 409);
    await env.DB.prepare('UPDATE opioid_moves SET voided_at = ?2, voided_by = ?3, void_reason = ?4 WHERE id = ?1')
      .bind(m.id, Date.now(), who, plainText(body.reason, 120) || 'حُذف').run();
    return json({ ok: true, left: left - sign * m.qty });
  }
  const qty = m.kind === 'use' ? Math.max(1, Math.min(10, Math.floor(Number(body.qty)) || 0)) : qtyOf(body.qty);
  if (!qty) return json({ error: 'qty_required' }, 400);
  const after = left - sign * m.qty + sign * qty;
  if (after < 0) return json({ error: 'not_enough', left }, 409);
  if (m.kind === 'use') {
    const patient = plainText(body.patient, 80);
    const patientNo = plainText(body.patientNo, 30) || null;
    const diagnosis = plainText(body.diagnosis, 120) || null;
    const sex = body.sex === 'f' ? 'f' : body.sex === 'm' ? 'm' : '';
    const age = Math.floor(Number(body.age));
    const ward = plainText(body.ward, 40);
    const date = String(body.date || '');
    if (!threeNames(patient)) return json({ error: 'patient_three_names' }, 400);
    // Records made before the diagnosis was asked for may stay without one.
    if (!diagnosis && m.diagnosis) return json({ error: 'diagnosis_required' }, 400);
    if (!sex) return json({ error: 'sex_required' }, 400);
    if (body.age === '' || body.age == null || !Number.isFinite(age) || age < 0 || age > 120) return json({ error: 'age_required' }, 400);
    if (!parse(m.wards, []).includes(ward)) return json({ error: 'ward_required' }, 400);
    if (!DATE_RE.test(date) || date > dutyDayNow()) return json({ error: 'bad_date' }, 400);
    await env.DB.prepare('UPDATE opioid_moves SET qty = ?2, patient = ?3, sex = ?4, age = ?5, ward = ?6, use_date = ?7, edited_at = ?8, edited_by = ?9, patient_no = ?10, diagnosis = ?11 WHERE id = ?1')
      .bind(m.id, qty, patient, sex, age, ward, date, Date.now(), who, patientNo, diagnosis).run();
  } else {
    await env.DB.prepare('UPDATE opioid_moves SET qty = ?2, note = ?3, edited_at = ?4, edited_by = ?5 WHERE id = ?1')
      .bind(m.id, qty, plainText(body.note, 120) || m.note, Date.now(), who).run();
  }
  return json({ ok: true, left: after });
}

/** Body: { id, reason }. A use recorded by mistake: the holder (their tenure), the admins, the owner. */
async function voidUse(request, env, auth) {
  const body = await readJson(request) || {};
  const m = await env.DB.prepare(
    "SELECT m.*, d.hosp, t.holder_key FROM opioid_moves m JOIN opioid_duties d ON d.id = m.duty_id LEFT JOIN opioid_tenures t ON t.id = m.tenure_id WHERE m.id = ? AND m.kind = 'use'"
  ).bind(Number(body.id)).first();
  if (!m) return json({ error: 'not_found' }, 404);
  if (m.voided_at) return json({ ok: true, already: true });
  const allowed = manages(auth, m.hosp) || (auth.a && m.holder_key && (await accountKey(env, auth)) === m.holder_key);
  if (!allowed) return json({ error: 'forbidden' }, 403);
  const reason = plainText(body.reason, 120);
  if (!reason) return json({ error: 'reason_required' }, 400);
  await env.DB.prepare('UPDATE opioid_moves SET voided_at = ?2, voided_by = ?3, void_reason = ?4 WHERE id = ?1').bind(m.id, Date.now(), auth.name || auth.r, reason).run();
  const left = (await leftOf(env, [m.duty_id])).get(m.item_id) || 0;
  return json({ ok: true, left });
}
