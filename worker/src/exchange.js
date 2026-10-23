/**
 * Duty exchange approval, switched on per hospital by its admins or the owner (off by default,
 * also for new hospitals: then residents exchange duties freely, as before).
 *
 * With approval on, a resident's exchange is a request:
 *   1. the resident who holds the duty is asked (notification) and approves or rejects;
 *      when they have no active account, or they asked themselves, this step is skipped;
 *   2. the hospital's admins (and the owner) approve or reject;
 *   3. on the admin's approval the roster entry changes at once (here, on the server).
 * A rejection at either step ends the request, and its requester is told why. Residents cannot change
 * the roster directly while approval is on (index.js refuses their roster writes).
 */

import { json, readJson, overLimit, plainText } from './lib.js';
import { nameKey } from './names.js';
import { notifyOne, notifyApprovers, dispatchPush } from './accounts.js';
import { limitedExchanger, exchangeSpecialties } from './exchspecs.js';

const HOSP_RE = /^[\w-]{1,48}$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const OPEN = ['owner_pending', 'admin_pending'];

/** Hospitals with exchange approval switched on (kv 'exchange_approval': JSON array of ids). */
export async function approvalHospitals(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'exchange_approval'").first();
  try { const v = JSON.parse((row && row.v) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

const isOwner = a => a.r === 'owner';
const seesAll = a => isOwner(a) || (a.h || []).includes('*');
const moderates = (a, hosp) => isOwner(a) || (a.r === 'admin' && (seesAll(a) || (a.h || []).includes(hosp)));
/** The requester's own hospital (the same rule as roster writes in index.js). */
const ownHospital = (a, hosp) => (a.a && a.hosp === hosp) || seesAll(a) || (a.h || []).includes(hosp);
const byOf = a => (a.a ? `${a.r}:${a.name || a.a}` : a.r);

export async function routeExchange(path, method, request, env, auth, url, ctx) {
  if (!/^\/api\/exchange(\/|$)/.test(path)) return null;
  if (!auth) return json({ error: 'unauthorized' }, 401);
  switch (`${method} ${path}`) {
    case 'GET /api/exchange/settings': return json({ ok: true, on: await approvalHospitals(env) });
    case 'POST /api/exchange/settings': return setApproval(request, env, auth);
    case 'GET /api/exchange': return list(env, auth);
    case 'POST /api/exchange/request': return createRequest(request, env, auth, ctx);
    case 'POST /api/exchange/decide': return decide(request, env, auth, ctx);
    case 'POST /api/exchange/cancel': return cancel(request, env, auth);
  }
  return json({ error: 'not_found' }, 404);
}

/** Body: { hosp, on }. The owner switches any hospital, an admin their own. */
async function setApproval(request, env, auth) {
  const body = await readJson(request) || {};
  const hosp = String(body.hosp || '');
  if (!HOSP_RE.test(hosp) || typeof body.on !== 'boolean') return json({ error: 'bad_request' }, 400);
  if (!moderates(auth, hosp)) return json({ error: 'forbidden' }, 403);
  const on = new Set(await approvalHospitals(env));
  if (body.on) on.add(hosp); else on.delete(hosp);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('exchange_approval', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify([...on])),
    env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(Date.now(), byOf(auth), `Exchange approval ${body.on ? 'on' : 'off'} (${hosp})`),
  ]);
  return json({ ok: true, on: [...on] });
}

function view(r, auth) {
  return {
    id: r.id, hosp: r.hosp, date: r.date, spec: r.spec, oldName: r.old_name, newName: r.new_name,
    requester: r.requester_name, status: r.status, note: r.note || '', ownerNote: r.owner_note || '',
    created: r.created_at, updated: r.updated_at,
    mine: !!auth.a && r.requester_id === auth.a,
    // What this person may do now.
    canOwnerDecide: r.status === 'owner_pending' && !!auth.a && r.owner_id === auth.a,
    canAdminDecide: r.status === 'admin_pending' && moderates(auth, r.hosp),
    canCancel: OPEN.includes(r.status) && !!auth.a && r.requester_id === auth.a,
  };
}

/** The requests this person sent, those waiting for them as the duty holder, and (admins) those to approve. */
async function list(env, auth) {
  const since = Date.now() - 45 * 24 * 3600 * 1000;
  const admin = auth.r === 'owner' || auth.r === 'admin';
  const scope = seesAll(auth) ? null : JSON.stringify(auth.h || []);
  const { results } = await env.DB.prepare(
    `SELECT * FROM exchange_requests
      WHERE (requester_id = ?1 OR owner_id = ?1 ${admin ? `OR (status NOT IN ('owner_pending', 'cancelled') ${scope ? 'AND hosp IN (SELECT value FROM json_each(?3))' : ''})` : ''})
        AND (status IN ('owner_pending', 'admin_pending') OR updated_at > ?2)
      ORDER BY id DESC LIMIT 100`
  ).bind(auth.a || '', since, ...(scope && admin ? [scope] : [])).all();
  return json({ ok: true, requests: results.map(r => view(r, auth)) });
}

/** Body: { h, date: 'DD/MM/YYYY', spec, oldName, newName }. */
async function createRequest(request, env, auth, ctx) {
  if (!auth.a) return json({ error: 'account_required' }, 403);
  if (!['user', 'anaesthesia', 'admin', 'owner'].includes(auth.r)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request) || {};
  const hosp = String(body.h || ''), date = String(body.date || ''), spec = String(body.spec || '');
  const oldName = plainText(body.oldName, 120), newName = plainText(body.newName, 120);
  if (!HOSP_RE.test(hosp) || !DATE_RE.test(date) || !spec || !oldName || !newName) return json({ error: 'bad_request' }, 400);
  if (nameKey(oldName) === nameKey(newName)) return json({ error: 'same_person' }, 400);
  if (!ownHospital(auth, hosp)) return json({ error: 'not_your_hospital' }, 403);
  if (!(await approvalHospitals(env)).includes(hosp)) return json({ error: 'approval_off' }, 409);
  if (limitedExchanger(auth) && !(await exchangeSpecialties(env, auth.a, hosp)).has(spec)) return json({ error: 'not_your_specialty' }, 403);
  if (await overLimit(env, 'xreq:' + auth.a, 20)) return json({ error: 'rate_limited' }, 429);
  // The duty must be on the roster as it is now.
  const entry = await env.DB.prepare(
    `SELECT id FROM records WHERE coll = 'sched' AND hosp = ?1 AND json_extract(data, '$.date') = ?2
       AND json_extract(data, '$.specCode') = ?3 AND json_extract(data, '$.name') = ?4 LIMIT 1`
  ).bind(hosp, date, spec, oldName).first();
  if (!entry) return json({ error: 'duty_not_found' }, 404);
  const dup = await env.DB.prepare(`SELECT id FROM exchange_requests WHERE sched_id = ? AND status IN ('owner_pending', 'admin_pending')`).bind(entry.id).first();
  if (dup) return json({ error: 'already_requested' }, 409);
  // The duty holder's account (registered at this hospital), unless they are the one asking.
  const holder = await env.DB.prepare(
    `SELECT id FROM accounts WHERE name_key = ? AND status = 'active' AND role IN ('user', 'anaesthesia', 'admin')
      AND (hosp = ?2 OR EXISTS (SELECT 1 FROM json_each(accounts.hospitals) WHERE value = ?2)) LIMIT 1`
  ).bind(nameKey(oldName), hosp).first();
  const ownerId = holder && holder.id !== auth.a ? holder.id : null;
  const status = ownerId ? 'owner_pending' : 'admin_pending';
  const now = Date.now();
  const ins = await env.DB.prepare(
    `INSERT INTO exchange_requests (hosp, date, spec, old_name, new_name, sched_id, requester_id, requester_name, owner_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(hosp, date, spec, oldName, newName, entry.id, auth.a, auth.name || '', ownerId, status, now, now).first();
  const data = JSON.stringify({ id: ins.id, h: hosp, date, spec, oldName, newName, by: auth.name || '' });
  const note = ownerId
    ? await notifyOne(env, ownerId, 'xreq:' + ins.id, 'exchange_request', data, now).all()
    : await notifyApprovers(env, hosp, 'xadm:' + ins.id, 'exchange_admin', data, now).all();
  dispatchPush(env, ctx, note);
  return json({ ok: true, id: ins.id, status });
}

/** Body: { id, approve, note? }: the duty holder at the first step, an admin of the hospital at the second. */
async function decide(request, env, auth, ctx) {
  const body = await readJson(request) || {};
  const r = await env.DB.prepare('SELECT * FROM exchange_requests WHERE id = ?').bind(Number(body.id) || 0).first();
  if (!r) return json({ error: 'not_found' }, 404);
  const approve = body.approve === true;
  const note = plainText(body.note, 300) || '';
  const now = Date.now();
  const data = (extra) => JSON.stringify({ id: r.id, h: r.hosp, date: r.date, spec: r.spec, oldName: r.old_name, newName: r.new_name, by: auth.name || '', note, ...extra });
  const pushes = [];

  if (r.status === 'owner_pending') {
    if (!auth.a || r.owner_id !== auth.a) return json({ error: 'forbidden' }, 403);
    const next = approve ? 'admin_pending' : 'rejected';
    const upd = await env.DB.prepare('UPDATE exchange_requests SET status = ?, owner_note = ?, owner_at = ?, updated_at = ? WHERE id = ? AND status = ?')
      .bind(next, note, now, now, r.id, 'owner_pending').run();
    if (!upd.meta.changes) return json({ error: 'already_decided' }, 409);
    const stmts = [
      env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('xreq:' + r.id),
      notifyOne(env, r.requester_id, 'xres:' + r.id, 'exchange_result', data({ step: approve ? 'owner_approved' : 'owner_rejected' }), now),
    ];
    if (approve) stmts.push(notifyApprovers(env, r.hosp, 'xadm:' + r.id, 'exchange_admin', data({ ownerApproved: true }), now));
    const res = await env.DB.batch(stmts);
    dispatchPush(env, ctx, res[1], res[2]);
    return json({ ok: true, status: next });
  }

  if (r.status === 'admin_pending') {
    if (!moderates(auth, r.hosp)) return json({ error: 'forbidden' }, 403);
    const by = byOf(auth);
    if (approve) {
      // The roster entry changes now, if it is still the duty that was asked for.
      const cur = await env.DB.prepare("SELECT v, data FROM records WHERE coll = 'sched' AND id = ?").bind(r.sched_id).first();
      let d = null;
      try { d = cur ? JSON.parse(cur.data) : null; } catch {}
      if (!d || d.name !== r.old_name || d.date !== r.date || d.specCode !== r.spec) {
        await env.DB.prepare("UPDATE exchange_requests SET status = 'rejected', note = ?, admin_by = ?, admin_at = ?, updated_at = ? WHERE id = ?")
          .bind('تغيّرت هذه الخفارة في الجدول قبل الموافقة', by, now, now, r.id).run();
        return json({ error: 'duty_changed' }, 409);
      }
      const ts = new Date(now + 3 * 3600 * 1000).toISOString().slice(11, 16);
      const msg = `Duty Exchange (approved): ${r.spec} on ${r.date} → ${r.new_name}`;
      const res = await env.DB.batch([
        env.DB.prepare(`INSERT INTO history (coll, id, hosp, v, data, deleted, ts, by, msg) SELECT coll, id, hosp, v, data, 0, ?2, ?3, ?4 FROM records WHERE coll = 'sched' AND id = ?1`)
          .bind(r.sched_id, now, by, msg),
        env.DB.prepare(`UPDATE records SET data = json_set(data, '$.name', ?2, '$.timestamp', ?3), v = v + 1, updated_at = ?4, updated_by = ?5, wid = NULL
                         WHERE coll = 'sched' AND id = ?1 AND v = ?6`).bind(r.sched_id, r.new_name, ts, now, by, cur.v),
        // Approved only if the roster entry really changed just above (same transaction).
        env.DB.prepare(`UPDATE exchange_requests SET status = 'approved', note = ?1, admin_by = ?2, admin_at = ?3, updated_at = ?3
                         WHERE id = ?4 AND status = 'admin_pending'
                           AND EXISTS (SELECT 1 FROM records WHERE coll = 'sched' AND id = ?5 AND updated_at = ?3 AND json_extract(data, '$.name') = ?6)`)
          .bind(note, by, now, r.id, r.sched_id, r.new_name),
        env.DB.prepare('INSERT INTO audit (ts, role, msg, n) VALUES (?, ?, ?, 1)').bind(now, by, msg),
        env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('xadm:' + r.id),
        notifyOne(env, r.requester_id, 'xres:' + r.id, 'exchange_result', data({ step: 'approved' }), now),
      ]);
      if (!res[1].meta.changes) return json({ error: 'duty_changed' }, 409);
      pushes.push(res[5]);
      if (r.owner_id) pushes.push(await notifyOne(env, r.owner_id, 'xres:' + r.id, 'exchange_result', data({ step: 'approved', holder: true }), now).all());
      dispatchPush(env, ctx, ...pushes);
      return json({ ok: true, status: 'approved' });
    }
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE exchange_requests SET status = 'rejected', note = ?, admin_by = ?, admin_at = ?, updated_at = ? WHERE id = ? AND status = 'admin_pending'")
        .bind(note, by, now, now, r.id),
      env.DB.prepare('DELETE FROM notifications WHERE gkey = ?').bind('xadm:' + r.id),
      notifyOne(env, r.requester_id, 'xres:' + r.id, 'exchange_result', data({ step: 'admin_rejected' }), now),
    ]);
    if (!res[0].meta.changes) return json({ error: 'already_decided' }, 409);
    dispatchPush(env, ctx, res[2]);
    return json({ ok: true, status: 'rejected' });
  }
  return json({ error: 'already_decided' }, 409);
}

/** The requester withdraws a request that is still open. */
async function cancel(request, env, auth) {
  const body = await readJson(request) || {};
  const r = await env.DB.prepare('SELECT id, requester_id, status FROM exchange_requests WHERE id = ?').bind(Number(body.id) || 0).first();
  if (!r) return json({ error: 'not_found' }, 404);
  if (!auth.a || r.requester_id !== auth.a) return json({ error: 'forbidden' }, 403);
  if (!OPEN.includes(r.status)) return json({ error: 'already_decided' }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE exchange_requests SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(Date.now(), r.id),
    env.DB.prepare('DELETE FROM notifications WHERE gkey IN (?, ?)').bind('xreq:' + r.id, 'xadm:' + r.id),
  ]);
  return json({ ok: true });
}
