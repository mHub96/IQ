// Duty reminders: duty start times, the queue rows, and the lead time in words.
// Run: node --test worker/test/reminders.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dutyPlan, plannedReminders, durationText } from '../src/reminders.js';

const H = 3600 * 1000;

test('each duty starts at its own time (Iraq = UTC+3)', () => {
  assert.equal(dutyPlan({ src: 'er', type: 'er', slot: 'preNight', date: '2026-10-22' }).start, Date.UTC(2026, 9, 22, 17));
  // The late night shift (2 AM) belongs to the duty day before.
  assert.equal(dutyPlan({ src: 'er', type: 'er', slot: 'lateNight', date: '2026-10-22' }).start, Date.UTC(2026, 9, 22, 23));
  assert.equal(dutyPlan({ src: 'er', type: 'con', slot: 'doctor', date: '2026-10-22' }).start, Date.UTC(2026, 9, 22, 5), 'whole duty day: 8 AM');
  const h = dutyPlan({ src: 'hospital', spec: 'S', time: '08:00PM - 08:00AM', date: '2026-10-22' }, { S: 'الجراحة' });
  assert.equal(h.start, Date.UTC(2026, 9, 22, 17));
  assert.equal(h.title, 'الجراحة');
  assert.equal(dutyPlan({ src: 'hospital', spec: 'X', time: '', date: '2026-10-22' }).title, 'X', 'no name: the duty code');
});

test('reminders are planned only for duties that have not started', () => {
  const now = Date.UTC(2026, 9, 22, 12);
  const rows = plannedReminders([
    { key: 'a', src: 'er', type: 'er', slot: 'morning', date: '2026-10-22' },   // 05:00 UTC, over
    { key: 'b', src: 'er', type: 'er', slot: 'preNight', date: '2026-10-22' },  // 17:00 UTC
  ], 90, {}, now);
  assert.deepEqual(rows.map(r => r.dkey), ['b']);
  assert.equal(rows[0].fire, Date.UTC(2026, 9, 22, 17) - 1.5 * H);
  assert.equal(rows[0].title, 'طوارئ · البرينايت');
});

test('lead times read naturally', () => {
  assert.equal(durationText(30), '30 دقيقة');
  assert.equal(durationText(60), 'ساعة');
  assert.equal(durationText(120), 'ساعتين');
  assert.equal(durationText(150), 'ساعتين و30 دقيقة');
  assert.equal(durationText(5 * 60), '5 ساعات');
  assert.equal(durationText(1440), 'يوم');
  assert.equal(durationText(1500), 'يوم وساعة');
  assert.equal(durationText(3 * 1440), '3 أيام');
});
