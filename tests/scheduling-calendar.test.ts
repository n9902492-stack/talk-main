import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDayStart, calendarParts, shiftCalendarDate, mergeCalendarSlots, calendarDayBlocks } from '../frontend/src/lib/schedulingCalendar';

test('calendar days use the host timezone and actual DST day lengths', () => {
  assert.equal(calendarParts(Date.parse('2026-10-25T20:00Z'), 'Asia/Kolkata').date, '2026-10-26');
  assert.equal(calendarDayStart('2026-10-26', 'Asia/Kolkata'), Date.parse('2026-10-25T18:30Z'));
  assert.equal((calendarDayStart('2026-03-09', 'America/New_York') - calendarDayStart('2026-03-08', 'America/New_York')) / 3600000, 23);
  assert.equal((calendarDayStart('2026-11-02', 'America/New_York') - calendarDayStart('2026-11-01', 'America/New_York')) / 3600000, 25);
  assert.equal(shiftCalendarDate('2026-12-31', 1), '2027-01-01');
});
test('available blocks preserve exact starts and do not bridge gaps', () => {
  const slots = [{ start: 0, end: 30 }, { start: 15, end: 45 }, { start: 60, end: 90 }];
  const merged = mergeCalendarSlots(slots);
  assert.equal(merged.length, 2); assert.deepEqual(merged[0].slots, slots.slice(0, 2));
  assert.equal(merged[0].end, 45); assert.deepEqual(slots[0], { start: 0, end: 30 });
});
test('bookings clip at midnight, exclude cancelled rows, and overlapping blocks receive separate lanes', () => {
  const day = '2026-10-26', time = (clock: string) => Date.parse(`${day}T${clock}Z`);
  const b = (id: string, start: number, end: number, status = 'confirmed') => ({ id, title: id, name: 'Fictional Guest', status, starts_at: start, ends_at: end, meeting_id: 'fixture' });
  const blocks = calendarDayBlocks(day, 'UTC', [b('a', time('10:00'), time('11:00')), b('b', time('10:30'), time('11:30')), b('cancelled', time('12:00'), time('13:00'), 'cancelled'), b('overnight', time('00:00') - 1800000, time('00:30'))], [{ start: time('14:00'), end: time('14:30') }]);
  assert.ok(!blocks.some(block => block.id === 'cancelled'));
  assert.equal(blocks.find(block => block.id === 'overnight')?.minute, 0);
  assert.notEqual(blocks.find(block => block.id === 'a')?.lane, blocks.find(block => block.id === 'b')?.lane);
  assert.equal(blocks.find(block => block.id === 'a')?.lanes, 2);
  assert.equal(blocks.find(block => block.kind === 'available')?.minute, 840);
});
