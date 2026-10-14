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
