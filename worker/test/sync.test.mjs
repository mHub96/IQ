// Run: node --test worker/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HubSync = require(path.join(root, 'hub-sync.js'));

const toRows = records => [...records.values()].map(r => [r.c, r.id, r.h, r.o, 1, JSON.parse(r.s)]);
const strip = db => {
  const copy = JSON.parse(JSON.stringify(db));
  delete copy.lastUpdated;
  delete copy.globalPasswords;
  for (const h of Object.values(copy.hospitals)) delete h.passwords;
  return copy;
};
const sortKeys = v => JSON.parse(HubSync.stableStringify(v));
// A private data snapshot (never committed): worker/.local/test-hub-data.json, or HUB_DATA=<path>.
const DATA_FILE = process.env.HUB_DATA || path.join(root, 'worker', '.local', 'test-hub-data.json');

test('decompose -> compose round-trips the real database', () => {
  const original = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // decompose() makes duplicate resident ids unique in place; everything else must survive untouched.
  const input = JSON.parse(JSON.stringify(original));
  const { records, secrets } = HubSync.decompose(input);
  const changedIds = original.residents.filter((r, i) => r.id !== input.residents[i].id);
  assert.ok(changedIds.length <= 2, 'only the known duplicate ids are renamed');
  const rebuilt = HubSync.compose(toRows(records));
  assert.deepEqual(sortKeys(strip(rebuilt)), sortKeys(strip(input)));
  assert.ok(secrets.global && secrets.global.owner, 'global passwords extracted');
  for (const hid of Object.keys(original.hospitals)) {
    assert.deepEqual(secrets[hid], original.hospitals[hid].passwords);
  }
});

test('a rebuilt database diffs to zero ops against its own rows', () => {
  const original = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const rows = toRows(HubSync.decompose(original).records);
  const db = HubSync.compose(rows);
  const ops = HubSync.diff(HubSync.baseFromRows(rows), HubSync.decompose(db).records);
  assert.equal(ops.length, 0, JSON.stringify(ops.slice(0, 3)));
});

test('editing one duty in place sends one put with the same id', () => {
  const db = { hospitals: { h1: { id: 'h1', schedule: [{ date: '01/10/2026', specCode: 'GS', name: 'A' }, { date: '02/10/2026', specCode: 'GS', name: 'B' }] } }, residents: [] };
  const rows = toRows(HubSync.decompose(db).records);
  const live = HubSync.compose(rows);
  const base = HubSync.baseFromRows(rows);
  live.hospitals.h1.schedule[0].name = 'C';
  const ops = HubSync.diff(base, HubSync.decompose(live).records);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].c, 'sched');
  assert.equal(ops[0].bv, 1);
  assert.equal(ops[0].d.name, 'C');
});

test('removing a duty sends a delete, adding one sends a create', () => {
  const db = { hospitals: { h1: { id: 'h1', schedule: [{ date: '01/10/2026', specCode: 'GS', name: 'A' }] } }, residents: [] };
  const rows = toRows(HubSync.decompose(db).records);
  const live = HubSync.compose(rows);
  live.hospitals.h1.schedule = [{ date: '03/10/2026', specCode: 'GS', name: 'Z' }];
  const ops = HubSync.diff(HubSync.baseFromRows(rows), HubSync.decompose(live).records);
  assert.deepEqual(ops.map(o => o.del ? 'del' : o.bv === 0 ? 'new' : 'put').sort(), ['del', 'new']);
});

test('duplicate resident ids are made unique deterministically', () => {
  const mk = () => ({ residents: [{ id: 'r1', name: 'A' }, { id: 'r1', name: 'B' }], hospitals: {} });
  const a = [...HubSync.decompose(mk()).records.keys()];
  const b = [...HubSync.decompose(mk()).records.keys()];
  assert.equal(new Set(a).size, 2);
  assert.deepEqual(a, b);
});

test('merge3 keeps both sides\' changes and lets a deletion stick', () => {
  const base = { a: 1, b: 1, list: [{ id: 1, n: 'x' }, { id: 2, n: 'y' }] };
  const local = { a: 2, b: 1, list: [{ id: 1, n: 'x' }] };              // edits a, deletes item 2
  const remote = { a: 1, b: 3, list: [{ id: 1, n: 'X' }, { id: 2, n: 'y' }, { id: 3, n: 'z' }] }; // edits b, renames 1, adds 3
  assert.deepEqual(HubSync.merge3(base, local, remote), { a: 2, b: 3, list: [{ id: 1, n: 'X' }, { id: 3, n: 'z' }] });
});

test('merge3: local wins on a true clash', () => {
  assert.deepEqual(HubSync.merge3({ a: 1 }, { a: 2 }, { a: 3 }), { a: 2 });
});

test('applyRecord updates objects in place', () => {
  const rows = toRows(HubSync.decompose({ hospitals: { h1: { id: 'h1', name_ar: 'x', schedule: [{ date: 'd', name: 'A' }] } }, residents: [{ id: 'r1', name: 'A' }] }).records);
  const db = HubSync.compose(rows);
  const hospRef = db.hospitals.h1;
  const resRef = db.residents[0];
  HubSync.applyRecord(db, 'hospital', 'h1', 'h1', { id: 'h1', name_ar: 'y' });
  HubSync.applyRecord(db, 'resident', 'r1', null, { id: 'r1', name: 'B' });
  assert.equal(hospRef.name_ar, 'y');
  assert.equal(hospRef.schedule.length, 1, 'schedule kept');
  assert.equal(resRef.name, 'B');
});
