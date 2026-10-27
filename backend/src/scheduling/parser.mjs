function parseSchedule(input) {
  if (typeof input !== "string" || input.length > 1e3) return { fields: {}, ambiguities: ["Enter up to 1,000 characters."], supported: false };
  let remaining = input.toLowerCase();
  const fields = {}, ambiguities = [];
  const consume = (regex, handler) => {
    remaining = remaining.replace(regex, (...args) => {
      handler(...args);
      return " ";
    });
  };
  consume(/(?:with (?:a )?)?(\d+)\s*[- ]?minute buffer/g, (_, n) => {
    fields.bufferAfter = Number(n);
  });
  consume(/(?:at least )?(\d+)\s*(hours?|minutes?) (?:advance )?notice/g, (_, n, unit) => {
    fields.notice = Number(n) * (unit.startsWith("hour") ? 60 : 1);
  });
  consume(/(?:maximum|max|up to) (\d+) (?:meetings|bookings) (?:per day|daily)/g, (_, n) => {
    fields.maxDaily = Number(n);
  });
  consume(/(?:capacity (?:of )?|up to )(\d+)(?: participants| people)?/g, (_, n) => {
    fields.capacity = Number(n);
  });
  consume(/\b(\d+)\s*[- ]?minutes?\b/g, (_, n) => {
    if (fields.duration !== void 0) ambiguities.push("Conflicting duration expressions.");
    fields.duration = Number(n);
  });
  consume(/\bweekdays\b/g, () => {
    fields.days = [1, 2, 3, 4, 5];
  });
  consume(/\bweekends\b/g, () => {
    fields.days = [0, 6];
  });
  const named = [["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6]];
  const days = [];
  for (const [name, index] of named) consume(new RegExp(`\\b${name}s?\\b`, "g"), () => days.push(index));
  if (days.length) {
    if (fields.days) ambiguities.push("Confirm the combined day selection.");
    fields.days = days;
  }
  consume(/(?:between|from) (\d{1,2})(?::(\d{2}))?\s*(am|pm) (?:and|to|-) (\d{1,2})(?::(\d{2}))?\s*(am|pm)/g, (_, h, m, a, j, n, b) => {
    const clock = (hour, min, period) => Number(hour) % 12 * 60 + Number(min || 0) + (period === "pm" ? 720 : 0);
    if (Number(h) < 1 || Number(h) > 12 || Number(j) < 1 || Number(j) > 12 || Number(m || 0) > 59 || Number(n || 0) > 59) ambiguities.push("Invalid clock time.");
    fields.start = clock(h, m, a);
    fields.end = clock(j, n, b);
    if (fields.end <= fields.start) ambiguities.push("Confirm overnight or reversed working hours.");
  });
  consume(/(?:between|from) (\d{2}):(\d{2}) (?:and|to|-) (\d{2}):(\d{2})/g, (_, h, m, j, n) => {
    fields.start = Number(h) * 60 + Number(m);
    fields.end = Number(j) * 60 + Number(n);
    if (Number(h) > 23 || Number(j) > 23 || Number(m) > 59 || Number(n) > 59 || fields.end <= fields.start) ambiguities.push("Confirm working hours.");
  });
  remaining = remaining.replace(/\s+/g, " ").trim();
  const title = remaining.match(/(?:create (?:a |an )?|^)([a-z][a-z -]{1,79}?)\s+link\b/);
  if (title) {
    fields.title = title[1].trim().replace(/^(?:a|an)\s+/, "").replace(/\b\w/g, (c) => c.toUpperCase());
    remaining = remaining.replace(title[0], " ");
  }
  remaining = remaining.replace(/\b(create|a|an|link|for|with|and|on|the|please|booking)\b/g, " ").replace(/[.,]/g, " ").trim().replace(/\s+/g, " ");
  if (remaining) ambiguities.push(`Unrecognized text: ${remaining}`);
  for (const key of ["title", "duration", "days", "start", "end"]) if (fields[key] === void 0) ambiguities.push(`Confirm ${key}.`);
  if (fields.duration !== void 0 && (fields.duration < 5 || fields.duration > 240)) ambiguities.push("Duration must be 5\u2013240 minutes.");
  return { fields, ambiguities, supported: ambiguities.length === 0, method: "deterministic", requiresConfirmation: true };
}
const futureSchedulingAI = Object.freeze({ enabled: false, parse: () => {
  throw new Error("External scheduling AI is disabled.");
} });
export {
  futureSchedulingAI,
  parseSchedule
};
