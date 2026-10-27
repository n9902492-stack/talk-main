const MINUTE = 60_000;
const formatters = new Map();

function localParts(instant, timezone) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function wallClockInstant(date, hour, timezone) {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  const candidates = new Set();
  // Sample both sides of a transition; never assume a fixed UTC offset or a 24-hour day.
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall + delta * 60 * MINUTE;
    const parts = localParts(sample, timezone);
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample;
    candidates.add(wall - offset);
  }
  const matching = [...candidates].filter(candidate => {
    const parts = localParts(candidate, timezone);
    return parts.year === date.year && parts.month === date.month && parts.day === date.day
      && parts.hour === hour && parts.minute === 0;
  });
  if (matching.length) return Math.min(...matching); // First occurrence during a repeated hour.

  // Some IANA zones move their clocks at midnight. In a gap, use the first real
  // instant on the meeting's local date at or after the requested wall time.
  let earliest;
  for (let instant = wall - 18 * 60 * MINUTE; instant <= wall + 18 * 60 * MINUTE; instant += MINUTE) {
    const parts = localParts(instant, timezone);
    if (parts.year === date.year && parts.month === date.month && parts.day === date.day
      && parts.hour * 60 + parts.minute >= hour * 60) {
      earliest = instant;
      break;
    }
  }
  return earliest;
}

/**
 * Meeting-day reminder: 09:00 in the recipient's zone, or local midnight for an
 * appointment before 09:30. Late-created bookings receive it immediately only when
 * at least 15 minutes separate it from the 15-minute reminder. Day reminders
 * expire at the 15-minute boundary; final reminders expire when the meeting starts.
 */
export function plannedReminders(start, timezone, now) {
  if (!Number.isFinite(start) || !Number.isFinite(now)) throw new TypeError('Invalid reminder time.');
  const date = localParts(start, timezone); // Validates the IANA timezone even for past events.
  if (now >= start) return [];
  const fifteenAt = start - 15 * MINUTE;
  const nominalDay = wallClockInstant(date, date.hour < 9 || date.hour === 9 && date.minute < 30 ? 0 : 9, timezone);
  const dayDue = Math.max(now, nominalDay ?? start);
  const reminders = [];
  if (dayDue <= fifteenAt - 15 * MINUTE) {
    reminders.push({ kind: 'reminder_day', dueAt: dayDue, expiresAt: fifteenAt });
  }
  reminders.push({ kind: 'reminder_15', dueAt: Math.max(now, fifteenAt), expiresAt: start });
  return reminders;
}
