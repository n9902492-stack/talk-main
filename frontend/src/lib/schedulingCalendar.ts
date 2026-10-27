export type CalendarSlot = { start: number; end: number };
export type CalendarBooking = { id: string; title: string; name: string; status: string; starts_at: number; ends_at: number; meeting_id: string };
export type CalendarBlock = { id: string; kind: 'booking' | 'available'; start: number; end: number; minute: number; until: number; slots?: CalendarSlot[]; booking?: CalendarBooking; lane?: number; lanes?: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
export function calendarParts(time: number, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
export function shiftCalendarDate(date: string, days: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
// Find actual local midnight instead of assuming every local day lasts 24 hours.
export function calendarDayStart(date: string, timezone: string) {
  const reference = Date.parse(date + 'T00:00:00Z') / 60000;
  let low = reference - 2880, high = reference + 2880;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarParts(middle * 60000, timezone).date < date) low = middle + 1;
    else high = middle;
  }
  return low * 60000;
}
export function mergeCalendarSlots(slots: CalendarSlot[]) {
  const result: { start: number; end: number; slots: CalendarSlot[] }[] = [];
  for (const slot of [...slots].sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && slot.start <= previous.end) { previous.end = Math.max(previous.end, slot.end); previous.slots.push(slot); }
    else result.push({ start: slot.start, end: slot.end, slots: [slot] });
  }
  return result;
}
export function calendarDayBlocks(date: string, timezone: string, bookings: CalendarBooking[], slots: CalendarSlot[]) {
  const start = calendarDayStart(date, timezone), end = calendarDayStart(shiftCalendarDate(date, 1), timezone);
  const blocks: CalendarBlock[] = [
    ...bookings.filter(booking => booking.status === 'confirmed' && booking.starts_at < end && booking.ends_at > start).map(booking => ({ id: booking.id, kind: 'booking' as const, start: Math.max(start, booking.starts_at), end: Math.min(end, booking.ends_at), booking })),
    ...mergeCalendarSlots(slots.filter(slot => slot.start >= start && slot.start < end)).map((group, i) => ({ id: `available-${date}-${i}`, kind: 'available' as const, start: group.start, end: Math.min(end, group.end), slots: group.slots })),
  ].map(block => {
    const minute = calendarParts(block.start, timezone).minute;
    const wallEnd = block.end === end ? 1440 : calendarParts(block.end, timezone).minute;
    // Repeated DST clock times remain separate, with exact offsets in labels.
    const until = wallEnd > minute ? wallEnd : minute + (block.end - block.start) / 60000;
    return { ...block, minute, until: Math.min(1440, Math.max(minute + 25, until)) };
  }).sort((a, b) => a.minute - b.minute || b.until - a.until);
  // Pack visual overlaps into lanes, including repeated DST hours/group slots.
  let group: CalendarBlock[] = [], occupied: number[] = [], groupEnd = -1;
  const finish = () => { for (const block of group) block.lanes = occupied.length; group = []; occupied = []; };
  for (const block of blocks) {
    if (block.minute >= groupEnd) finish();
    let lane = occupied.findIndex(until => until <= block.minute);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = block.until; block.lane = lane;
    group.push(block); groupEnd = Math.max(groupEnd, block.until);
  }
  finish();
  return blocks;
}
