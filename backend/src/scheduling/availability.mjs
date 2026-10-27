const formatters = /* @__PURE__ */ new Map();
function localParts(timestamp, timezone) {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    if (formatters.size > 100) formatters.clear();
    formatters.set(timezone, f);
  }
  const p = Object.fromEntries(f.formatToParts(timestamp).map((v) => [v.type, v.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minute: Number(p.hour) * 60 + Number(p.minute) };
}
const overlaps = (a, b, c, d) => a < d && c < b;
function slotReason({ start, event, profile, windows, overrides = [], busy = [], now, ignoreId }) {
  const cfg = profile.settings, end = start + event.duration * 6e4, p = localParts(start, profile.timezone), last = localParts(end - 1, profile.timezone);
  if (start < now + cfg.notice * 6e4 || start > now + cfg.horizon * 864e5) return "booking_window";
  if (start % 6e4 !== 0 || p.minute % 15 !== 0) return "slot_alignment";
  const override = overrides.find((o) => o.date === p.date);
  const spans = override ? override.windows : windows.filter((w) => w.weekday === p.weekday);
  const inside = (part) => part.date === p.date && spans.some((w) => part.minute >= w.start && part.minute < w.end);
  if (!inside(p) || !inside(last)) return "working_hours";
  if (last.minute + 1 - p.minute === event.duration && !spans.some((w) => p.minute >= w.start && last.minute < w.end)) return "working_hours";
  if (last.minute + 1 - p.minute !== event.duration) {
    for (let t = start; t < end; t += 6e4) {
      const part = localParts(t, profile.timezone);
      if (!inside(part)) return "working_hours";
      if (cfg.focus.some((w) => w.weekday === part.weekday && part.minute >= w.start && part.minute < w.end)) return "focus";
    }
  }
  if (cfg.focus.some((w) => w.weekday === p.weekday && overlaps(p.minute, last.minute + 1, w.start, w.end))) return "focus";
  const rows = busy.filter((b) => b.id !== ignoreId && b.status === "confirmed");
  const same = rows.find((b) => b.event_id === event.id && b.starts_at === start);
  if (same && same.ends_at === end && same.count < event.capacity) return null;
  if (same) return "capacity";
  const tail = (duration) => Math.max(cfg.bufferAfter, duration > cfg.longThreshold ? cfg.longBreak : 0) * 6e4;
  if (rows.some((b) => overlaps(start - cfg.bufferBefore * 6e4, end + tail(event.duration), b.starts_at - cfg.bufferBefore * 6e4, b.ends_at + tail((b.ends_at - b.starts_at) / 6e4)))) return "busy";
  const day = rows.filter((b) => localParts(b.starts_at, profile.timezone).date === p.date);
  if (day.length >= cfg.maxDaily) return "daily_count";
  if (day.reduce((sum, b) => sum + (b.ends_at - b.starts_at) / 6e4, 0) + event.duration > cfg.maxMinutes) return "daily_minutes";
  return null;
}
function availableSlots(input, from, to) {
  const result = [];
  for (let t = Math.ceil(from / 6e4) * 6e4; t < to; t += 6e4) if (!slotReason({ ...input, start: t })) result.push({ start: t, end: t + input.event.duration * 6e4 });
  return result;
}
function recommendations(slots, timezone, preference = "earliest") {
  const picks = [["Earliest available", slots[0]], ["Morning", slots.find((s) => localParts(s.start, timezone).minute < 720)], ["Afternoon", slots.find((s) => localParts(s.start, timezone).minute >= 720)]];
  if (preference !== "earliest") picks.push(["Host preference", slots.find((s) => preference === "morning" ? localParts(s.start, timezone).minute < 720 : localParts(s.start, timezone).minute >= 720)]);
  const seen = /* @__PURE__ */ new Set();
  return picks.filter(([, s]) => s && !seen.has(s.start) && seen.add(s.start)).map(([label, slot]) => ({ ...slot, label }));
}
export {
  availableSlots,
  localParts,
  recommendations,
  slotReason
};
