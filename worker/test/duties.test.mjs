// Matching an account to the ER residents database, and validation of ER preferences.
// Run: node --test worker/test/duties.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickResident, cleanPrefs } from '../src/duties.js';

const ER = [
  { id: 'er_1', name: 'د. زهراء سهيل نجم', phone: '' },
  { id: 'er_2', name: 'د. علي حسين عبدالرضا جاسم', phone: '07801234567' },
  { id: 'er_3', name: 'د. علي حسين كاظم', phone: '' },
  { id: 'er_4', name: 'د. مرتضى أمين عبد الحضر', phone: '' },
];

test('an account finds its ER entry by phone, then by name', () => {
  assert.equal(pickResident(ER, { name: 'anything', phone: '+964 780 123 4567' }).id, 'er_2', 'phone wins');
  assert.equal(pickResident(ER, { name: 'زهراء سهيل نجم', phone: '' }).id, 'er_1', 'title and spelling do not matter');
  assert.equal(pickResident(ER, { name: 'د. مرتضى امين عبدالحضر', phone: '' }).id, 'er_4', 'أ/ا and "عبد الحضر" variants');
  assert.equal(pickResident(ER, { name: 'د. علي حسين عبدالرضا', phone: '' }).id, 'er_2', 'first three names, one candidate');
  assert.equal(pickResident(ER, { name: 'د. علي حسين', phone: '' }), null, 'two "علي حسين": ambiguous, no match');
  assert.equal(pickResident(ER, { name: 'د. سارة محمد', phone: '' }), null);
});

test('preferences are cleaned to what the ER page understands', () => {
  const p = cleanPrefs({
    prefShifts: ['morning', 'morning', 'brunch'],
    prefDays: ['الأحد', 'Sunday'],
    prefDaysMode: 'weird',
    specificDays: [5, '3', 31, 0, 2.5],
    intervalMode: 'strictly_within',
    excludedIntervals: [{ start: '2026-11-20', end: '2026-11-15' }, { start: '', end: '2026-11-03' }, { start: 'x' }],
    noConsecutiveDays: false,
  }, '2026-11');
  assert.deepEqual(p.prefShifts, ['morning']);
  assert.deepEqual(p.prefDays, ['الأحد']);
  assert.equal(p.prefDaysMode, 'exclude');
  assert.deepEqual(p.specificDays, [3, 5], 'November has 30 days; non-integers dropped');
  assert.equal(p.intervalMode, 'strictly_within');
  assert.deepEqual(p.excludedIntervals, [{ start: '2026-11-15', end: '2026-11-20' }, { start: '2026-11-03', end: '2026-11-03' }]);
  assert.equal(p.noConsecutiveDays, false);
  assert.deepEqual(cleanPrefs({ prefShifts: ['morning', 'afternoon', 'preNight', 'lateNight'] }, '2026-11').prefShifts, [], 'all four shifts = no preference');
  assert.equal(cleanPrefs(null, '2026-02').noConsecutiveDays, true, 'default: avoid consecutive days');
});

test('a structured ER month: positions with their place and hours', async () => {
  const { monthPositions, erDutyPlan } = await import('../src/duties.js');
  const classic = monthPositions({ er: [] });
  assert.deepEqual(classic.er.map(p => p.key), ['morning', 'afternoon', 'preNight', 'lateNight']);
  assert.deepEqual(classic.con.map(p => p.key), ['doctor']);
  const month = { layout: {
    er: [
      { key: 'morning', shift: 'morning', sector: 'طوارئ النساء', division: '', n: 1, of: 1 },
      { key: 'morning.1', shift: 'morning', sector: 'طوارئ الرجال', division: '', n: 1, of: 1 },
      { key: 'afternoon', shift: 'afternoon', sector: 'طوارئ النساء', division: 'الطوارئ الخضراء', n: 1, of: 1 },
      { key: 'afternoon.1', shift: 'afternoon', sector: 'طوارئ النساء', division: 'الطوارئ الصفراء', n: 2, of: 2 },
    ],
    con: [{ key: 'doctor', start: '16:00', end: '19:00' }, { key: 'doctor.1', start: '19:00', end: '00:00' }],
    dc: [{ key: 'doctor' }],
  } };
  const pos = monthPositions(month);
  assert.equal(pos.er.find(p => p.key === 'afternoon.1').place, 'طوارئ النساء · الطوارئ الصفراء · 2');
  assert.ok(pos.rs.some(p => p.key === 'er_morning.1') && pos.rs.some(p => p.key === 'ward_floor4'), 'the strike follows the ER');
  const g = erDutyPlan({ type: 'er', slot: 'afternoon.1', place: 'طوارئ النساء · الطوارئ الصفراء' });
  assert.equal(g.title, 'طوارئ · بعد الصباحية · طوارئ النساء · الطوارئ الصفراء');
  assert.deepEqual([g.h, g.len], [14, 6]);
  const c = erDutyPlan({ type: 'con', slot: 'doctor.1', start: '19:00', end: '00:00' });
  assert.deepEqual([c.h, c.min, c.len], [19, 0, 5]);
  assert.match(c.title, /7م - 12ص$/);
  assert.deepEqual([erDutyPlan({ type: 'rs', slot: 'er_lateNight.1' }).h, erDutyPlan({ type: 'con', slot: 'doctor' }).len], [2, 24]);
});
