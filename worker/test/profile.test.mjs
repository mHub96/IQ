// Stage level-up, duty-day clock and parsing of the ER scheduler's values.
// Run: node --test worker/test/profile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStage, dutyDayNow, parseStage, parseBoard, profileComplete } from '../src/profile.js';

const iraq = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - 3 * 3600 * 1000; // Iraq local time -> ms

test('stage moves up once per level-up month and stops at the board length', () => {
  const setOn = iraq(2026, 3, 15);
  assert.equal(currentStage(2, setOn, 5, 10, iraq(2026, 9, 30, 23, 59)), 2);
  assert.equal(currentStage(2, setOn, 5, 10, iraq(2026, 10, 1, 0, 0)), 3, 'up at 00:00 on 1 October (Iraq time)');
  assert.equal(currentStage(2, setOn, 5, 10, iraq(2027, 10, 2)), 4);
  assert.equal(currentStage(2, setOn, 5, 10, iraq(2030, 10, 2)), 5, 'capped at the board length');
  assert.equal(currentStage(2, setOn, null, 10, iraq(2030, 10, 2)), 7, 'no cap when the length is unknown');
  assert.equal(currentStage(2, setOn, 5, 4, iraq(2026, 3, 31)), 2, 'another month (April): not yet');
  assert.equal(currentStage(2, setOn, 5, 4, iraq(2026, 10, 1)), 3, 'April 2026 passed, October does nothing');
  assert.equal(currentStage(2, setOn, 5, 4, iraq(2027, 4, 1)), 4);
  assert.equal(currentStage(null, setOn, 5, 10, iraq(2030, 1, 1)), null);
  // Set on the level-up day itself (after midnight): that day's level-up is already included.
  assert.equal(currentStage(3, iraq(2026, 10, 1, 9), 5, 10, iraq(2026, 12, 1)), 3);
});

test('the duty day runs from 08:00 to 08:00 Iraq time', () => {
  assert.equal(dutyDayNow(iraq(2026, 10, 13, 7, 59)), '2026-10-12');
  assert.equal(dutyDayNow(iraq(2026, 10, 13, 8, 0)), '2026-10-13');
  assert.equal(dutyDayNow(iraq(2026, 10, 13, 23, 30)), '2026-10-13');
  assert.equal(dutyDayNow(iraq(2026, 10, 14, 2, 0)), '2026-10-13');
});

test('ER values are understood', () => {
  assert.equal(parseStage('الثالثة'), 3);
  assert.equal(parseStage('الرابعة'), 4);
  assert.equal(parseStage('2.0'), 2);
  assert.equal(parseStage('0.0'), null);
  assert.equal(parseStage('-'), null);
  assert.equal(parseStage('FINAL'), null);
  assert.equal(parseBoard('Arabic'), 'arab');
  assert.equal(parseBoard('Iraqi'), 'iraqi');
  assert.equal(parseBoard('None'), 'none');
  assert.equal(parseBoard(''), null);
});

test('profile completeness', () => {
  assert.equal(profileComplete({ board: 'none', specialty: 'x' }), true);
  assert.equal(profileComplete({ board: 'arab', specialty: 'x', stage: 2 }), false);
  assert.equal(profileComplete({ board: 'arab', specialty: 'x', stage: 2, board_years: 5 }), true);
  assert.equal(profileComplete({ board: 'arab', specialty: null, stage: 2, board_years: 5 }), false);
});
