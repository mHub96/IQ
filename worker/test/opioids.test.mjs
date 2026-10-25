// The opioids responsibility (worker/src/opioids.js).
// Run: API_BASE=http://127.0.0.1:8787 node --test --test-concurrency=1 worker/test/opioids.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dutyDayNow } from '../src/profile.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const DATA = JSON.parse(fs.readFileSync(process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json'), 'utf8'));
const RUN = Date.now().toString(36).slice(-5);

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function deriveKey(username, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('hosp-hub/v1/' + username.toLowerCase()), iterations: 310000 },
    base, 256);
  return Buffer.from(bits).toString('base64');
}
const login = async password => (await call('POST', '/api/login', { body: { password } })).data.token;
async function rows(token) {
  let after = 0, page; const out = [];
  do { page = (await call('GET', `/api/db?after=${after}`, { token })).data; out.push(...page.rows); after = page.last; } while (page.more);
  return out;
}
async function account(res, hosp, u, rotator) {
  const username = u + '_' + RUN, key = await deriveKey(username, 'pass-O-1');
  const up = rotator
    ? await call('POST', '/api/accounts/signup-rotator', { body: { hosp, name: 'روتيتر ذمة اختبار', username, key, sex: 'm' } })
    : await call('POST', '/api/accounts/signup', { body: { hosp, name: res.name, phone: res.phone, username, key, sex: 'm' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const id = (await call('GET', '/api/accounts?filter=pending', { token: t.owner })).data.accounts.find(a => a.username === username).id;
  await call('POST', '/api/accounts/decide', { token: t.owner, body: { id, action: 'approve', ...(rotator ? { role: 'rotator' } : {}) } });
  const li = (await call('POST', '/api/accounts/login', { body: { username, key, deviceId: 'deviceP-' + u + RUN + 'xxxxxxxx', deviceLabel: 'Test' } })).data;
  return { id, tok: li.token };
}
const t = {};

test('setup: two residents with accounts and a rotator of the same hospital', async () => {
  t.owner = await login(DATA.globalPasswords.owner);
  t.admin = await login(DATA.globalPasswords.admin);
  const all = await rows(t.owner);
  const taken = new Set(((await call('GET', '/api/accounts?filter=all', { token: t.owner })).data.accounts || []).map(a => a.resident_id));
  const phones = new Map();
  const residents = all.filter(r => r[0] === 'resident').map(r => r[5]);
  for (const r of residents) phones.set(r.phone, (phones.get(r.phone) || 0) + 1);
  const ok = r => (r.hospitals || [])[0] && !taken.has(r.id) && r.active !== false && phones.get(r.phone) === 1 && /^\+?9647\d{9}$/.test(r.phone || '') && r.name.replace(/^د\.?\s*/, '').split(/\s+/).length >= 2;
  t.res = residents.find(ok);
  t.res2 = residents.find(r => ok(r) && r !== t.res && r.hospitals[0] === t.res.hospitals[0]);
  assert.ok(t.res && t.res2, 'two residents');
  t.h = t.res.hospitals[0];
  t.holder = await account(t.res, t.h, 'oph');
  t.second = await account(t.res2, t.h, 'op2');
  t.rot = await account(null, t.h, 'opr', true);
});

test('only the owner and the hospital admins manage duties', async () => {
  assert.equal((await call('GET', '/api/opioids')).status, 401);
  assert.equal((await call('GET', `/api/opioids?h=${t.h}`, { token: t.holder.tok })).status, 403);
  assert.equal((await call('GET', `/api/opioids?h=${t.h}`, { token: t.rot.tok })).status, 403);
  assert.equal((await call('GET', `/api/opioids?h=${t.h}`, { token: t.admin })).status, 200);
  assert.equal((await call('POST', '/api/opioids/duty', { token: t.holder.tok, body: { hosp: t.h, place: 'x', wards: ['y'], holder: { name: t.res.name }, items: [{ name: 'z', qty: 1 }] } })).status, 403);
});

test('holder suggestions: the hospital\'s residents, closest first, never rotators', async () => {
  const q = t.res.name.replace(/^د\.?\s*/, '').split(/\s+/).slice(0, 2).join(' ');
  const r = await call('GET', `/api/opioids/residents?h=${t.h}&q=${encodeURIComponent(q)}`, { token: t.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.residents.length >= 1 && r.data.residents.length <= 12);
  assert.equal(r.data.residents[0].res, t.res.id, 'the closest name first');
  assert.ok(!r.data.residents.some(x => x.name.includes('روتيتر ذمة')));
  assert.equal((await call('GET', `/api/opioids/residents?h=${t.h}&q=x`, { token: t.holder.tok })).status, 403);
});

test('create (draft), validation, then confirm and notify', async () => {
  const bad = await call('POST', '/api/opioids/duty', { token: t.admin, body: { hosp: t.h, place: 'الطابق الرابع', wards: [], holder: { res: t.res.id, name: t.res.name }, items: [{ name: 'Pethidine', qty: 10 }] } });
  assert.equal(bad.data.error, 'wards_required');
  assert.equal((await call('POST', '/api/opioids/duty', { token: t.admin, body: { hosp: t.h, place: 'x', wards: ['a'], holder: { name: 'د. لا أحد بهذا الاسم أبداً' }, items: [{ name: 'P', qty: 1 }] } })).data.error, 'holder_not_resident');
  assert.equal((await call('POST', '/api/opioids/duty', { token: t.admin, body: { hosp: t.h, place: 'x', wards: ['a'], holder: { res: t.res.id, name: t.res.name }, items: [] } })).data.error, 'items_required');
  const r = await call('POST', '/api/opioids/duty', { token: t.admin, body: {
    hosp: t.h, place: 'الطابق الرابع ' + RUN, wards: ['الباطنية', 'الجراحة'], holder: { res: t.res.id, name: t.res.name },
    items: [{ name: 'Pethidine 100mg', qty: 5, low: 2 }, { name: 'Morphine 10mg', qty: 2, low: 1 }],
  } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  t.duty = r.data.duty;
  assert.equal(t.duty.status, 'draft');
  assert.equal(t.duty.pending, true);
  assert.deepEqual(t.duty.items.map(i => i.left), [5, 2]);
  // Before confirmation: no tab for the holder, nothing to record.
  assert.equal((await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data.duties.filter(d => d.id === t.duty.id).length, 0);
  assert.equal((await call('GET', `/api/opioids/targets?h=${t.h}`, { token: t.rot.tok })).data.duties.filter(d => d.id === t.duty.id).length, 0);
  const c = await call('POST', '/api/opioids/confirm', { token: t.admin, body: { id: t.duty.id } });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.notified, 1);
  const n = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items.find(x => x.type === 'opioid_assigned');
  assert.ok(n && n.data.place.includes(RUN));
  const mine = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  assert.equal(mine.duties.length, 1);
  assert.equal(mine.duties[0].holding, true);
  assert.deepEqual(mine.duties[0].items.map(i => i.left), [5, 2]);
  assert.equal(mine.moves.filter(m => m.kind === 'issue').length, 2, 'the first issue is in the holder\'s log');
});

test('the roster button: the hospital\'s rotators and the holder; not other residents', async () => {
  assert.equal((await call('GET', `/api/opioids/targets?h=${t.h}`, { token: t.rot.tok })).data.duties.filter(d => d.id === t.duty.id).length, 1);
  assert.equal((await call('GET', `/api/opioids/targets?h=${t.h}`, { token: t.holder.tok })).data.duties.filter(d => d.id === t.duty.id).length, 1);
  assert.equal((await call('GET', `/api/opioids/targets?h=${t.h}`, { token: t.second.tok })).data.duties.length, 0);
  assert.equal((await call('GET', `/api/opioids/targets?h=${t.h}`, { token: t.owner })).data.duties.filter(d => d.id === t.duty.id).length, 1);
});

test('a rotator records a use: the holder is notified, low and empty alerts', async () => {
  const pet = t.duty.items[0], mor = t.duty.items[1];
  const base = { duty: t.duty.id, item: pet.id, patient: 'مريض اختبار', sex: 'm', age: 45, ward: 'الباطنية', date: dutyDayNow() };
  assert.equal((await call('POST', '/api/opioids/use', { token: t.rot.tok, body: { ...base, ward: 'ليست من الردهات' } })).data.error, 'ward_required');
  assert.equal((await call('POST', '/api/opioids/use', { token: t.rot.tok, body: { ...base, date: '2999-01-01' } })).data.error, 'bad_date');
  assert.equal((await call('POST', '/api/opioids/use', { token: t.second.tok, body: base })).status, 403, 'another resident cannot');
  const u1 = await call('POST', '/api/opioids/use', { token: t.rot.tok, body: base });
  assert.equal(u1.status, 200, JSON.stringify(u1.data));
  assert.equal(u1.data.left, 4);
  assert.equal(u1.data.low, false);
  let notes = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items;
  const used = notes.find(x => x.type === 'opioid_used' && x.data.duty === t.duty.id);
  assert.ok(used && used.data.left === 4 && used.data.by.includes('روتيتر ذمة'), JSON.stringify(used));
  // Two more: down to 2 = running low.
  const u2 = await call('POST', '/api/opioids/use', { token: t.rot.tok, body: { ...base, qty: 2, sex: 'f', age: 30, ward: 'الجراحة' } });
  assert.equal(u2.data.left, 2);
  assert.equal(u2.data.low, true);
  notes = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items;
  assert.ok(notes.find(x => x.type === 'opioid_low' && x.data.item === pet.name && x.data.left === 2));
  assert.equal((await call('POST', '/api/opioids/use', { token: t.rot.tok, body: { ...base, qty: 3 } })).data.error, 'not_enough');
  // The holder uses the morphine to the end: empty.
  await call('POST', '/api/opioids/use', { token: t.holder.tok, body: { ...base, item: mor.id, qty: 2 } });
  notes = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items;
  assert.ok(notes.find(x => x.type === 'opioid_empty' && x.data.item === mor.name && x.data.left === 0));
  const mine = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  const uses = mine.moves.filter(m => m.kind === 'use');
  assert.equal(uses.length, 3);
  assert.ok(uses.some(m => m.by.includes('روتيتر ذمة') && m.patient === 'مريض اختبار' && m.sex === 'm' && m.age === 45 && m.ward === 'الباطنية'));
});

test('void a mistaken use (the count comes back); admins replenish and withdraw', async () => {
  const mine = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  const use = mine.moves.find(m => m.kind === 'use' && m.qty === 2 && m.itemName.startsWith('Pethidine'));
  assert.equal((await call('POST', '/api/opioids/void', { token: t.rot.tok, body: { id: use.id, reason: 'خطأ' } })).status, 403, 'not the rotator');
  assert.equal((await call('POST', '/api/opioids/void', { token: t.holder.tok, body: { id: use.id } })).data.error, 'reason_required');
  const v = await call('POST', '/api/opioids/void', { token: t.holder.tok, body: { id: use.id, reason: 'سُجّل مرتين' } });
  assert.equal(v.data.left, 4);
  const pet = t.duty.items[0];
  assert.equal((await call('POST', '/api/opioids/stock', { token: t.holder.tok, body: { item: pet.id, qty: 5 } })).status, 403);
  assert.equal((await call('POST', '/api/opioids/stock', { token: t.admin, body: { item: pet.id, qty: 6 } })).data.left, 10);
  assert.equal((await call('POST', '/api/opioids/stock', { token: t.admin, body: { item: pet.id, qty: 11, kind: 'withdraw' } })).data.error, 'not_enough');
  assert.equal((await call('POST', '/api/opioids/stock', { token: t.admin, body: { item: pet.id, qty: 1, kind: 'withdraw', note: 'منتهي الصلاحية' } })).data.left, 9);
  const notes = (await call('GET', '/api/notifications', { token: t.holder.tok })).data.items;
  assert.ok(notes.find(x => x.type === 'opioid_stock' && x.data.left === 9));
});

test('a new holder: handover; each holder sees only their own records; admins see all', async () => {
  const d = (await call('GET', `/api/opioids?h=${t.h}`, { token: t.admin })).data.duties.find(x => x.id === t.duty.id);
  const items = d.items.map(i => ({ id: i.id, name: i.name, low: i.low }));
  const e = await call('POST', '/api/opioids/duty', { token: t.admin, body: { id: d.id, place: d.place, wards: d.wards, holder: { res: t.res2.id, name: t.res2.name }, items } });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.duty.pending, true, 'the change waits for confirmation');
  assert.equal(e.data.duty.holder.key.length > 0, true);
  await call('POST', '/api/opioids/confirm', { token: t.admin, body: { id: d.id } });
  const second = (await call('GET', '/api/opioids/mine', { token: t.second.tok })).data;
  assert.equal(second.duties[0].holding, true);
  assert.deepEqual(second.moves.map(m => m.kind).sort(), ['handover', 'handover'], 'only the handover so far');
  assert.equal(second.moves.find(m => m.itemName.startsWith('Pethidine')).qty, 9);
  const first = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  assert.equal(first.duties[0].holding, false, 'now an earlier duty');
  assert.equal(first.duties[0].items.length, 0, 'no stock for an earlier holder');
  assert.ok(first.moves.every(m => m.kind !== 'handover'), 'not the next holder\'s records');
  // The second records a use; the first does not see it, the admin does.
  await call('POST', '/api/opioids/use', { token: t.rot.tok, body: { duty: d.id, item: d.items[0].id, patient: 'مريض ثانٍ', sex: 'f', age: 60, ward: 'الجراحة' } });
  assert.equal((await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data.moves.filter(m => m.patient === 'مريض ثانٍ').length, 0);
  assert.equal((await call('GET', '/api/opioids/mine', { token: t.second.tok })).data.moves.filter(m => m.patient === 'مريض ثانٍ').length, 1);
  assert.equal((await call('GET', `/api/opioids?h=${t.h}`, { token: t.admin })).data.moves.filter(m => m.duty === d.id && m.kind === 'use').length, 4);
  assert.equal((await call('POST', '/api/opioids/use', { token: t.holder.tok, body: { duty: d.id, item: d.items[0].id, patient: 'x', sex: 'm', age: 1, ward: 'الجراحة' } })).status, 403, 'the former holder cannot record');
  // Back to the first holder: they see their two tenures' records, not the second's.
  await call('POST', '/api/opioids/duty', { token: t.admin, body: { id: d.id, place: d.place, wards: d.wards, holder: { res: t.res.id, name: t.res.name }, items } });
  await call('POST', '/api/opioids/confirm', { token: t.admin, body: { id: d.id } });
  const again = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  assert.equal(again.duties[0].holding, true);
  assert.equal(again.duties[0].tenures.length, 2);
  assert.equal(again.moves.filter(m => m.patient === 'مريض ثانٍ').length, 0);
  assert.ok(again.moves.some(m => m.kind === 'handover'), 'the handover of their new tenure');
});

test('an item with ampoules left cannot be removed; delete keeps the records', async () => {
  const d = (await call('GET', `/api/opioids?h=${t.h}`, { token: t.admin })).data.duties.find(x => x.id === t.duty.id);
  const keepOne = [{ id: d.items[1].id, name: d.items[1].name, low: 1 }];
  const r = await call('POST', '/api/opioids/duty', { token: t.admin, body: { id: d.id, place: d.place, wards: d.wards, holder: { res: t.res.id, name: t.res.name }, items: keepOne } });
  assert.equal(r.data.error, 'item_not_empty');
  assert.equal((await call('POST', '/api/opioids/delete', { token: t.holder.tok, body: { id: d.id } })).status, 403);
  assert.equal((await call('POST', '/api/opioids/delete', { token: t.admin, body: { id: d.id } })).data.ok, true);
  assert.equal((await call('GET', `/api/opioids?h=${t.h}`, { token: t.admin })).data.duties.filter(x => x.id === d.id).length, 0);
  const mine = (await call('GET', '/api/opioids/mine', { token: t.holder.tok })).data;
  assert.equal(mine.duties.find(x => x.id === d.id).holding, false);
  assert.ok(mine.moves.length > 0, 'the holder keeps their records');
});

test('cleanup', async () => {
  for (const a of [t.holder, t.second, t.rot]) if (a) await call('POST', '/api/accounts/decide', { token: t.owner, body: { id: a.id, action: 'delete' } });
});
