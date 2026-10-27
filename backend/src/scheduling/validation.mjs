import { MeetingError } from "../meeting-management.mjs";
const reject = (status, code, message) => {
  throw new MeetingError(status, code, message);
};
function text(value, max = 80) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) reject(400, "invalid_scheduling_input", "Enter valid scheduling details.");
  return value.trim();
}
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) reject(400, "invalid_scheduling_input", "A scheduling limit is outside its permitted range.");
  return value;
}
function zone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    if (typeof value !== "string" || value.length > 80) throw 0;
    return value;
  } catch {
    reject(400, "invalid_timezone", "Choose a valid IANA timezone.");
  }
}
function email(value) {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(result)) reject(400, "invalid_email", "Enter a valid email address.");
  return result;
}
function windows(value) {
  if (!Array.isArray(value) || value.length > 28) reject(400, "invalid_windows", "Choose up to 28 availability windows.");
  if (value.some((w) => !w || typeof w !== "object" || Array.isArray(w))) reject(400, "invalid_windows", "Choose valid availability windows.");
  return value.map((w) => ({ weekday: integer(w.weekday, 0, 6), start: integer(w.start, 0, 1439), end: integer(w.end, w.start + 1, 1440) }));
}
function settings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(400, "invalid_settings", "Enter valid scheduling settings.");
  const defaults = { bufferBefore: 0, bufferAfter: 10, notice: 120, horizon: 30, maxDaily: 8, maxMinutes: 360, longThreshold: 45, longBreak: 15, preferred: "earliest", focus: [], embedOrigins: [] };
  const result = { ...defaults };
  for (const [key, min, max] of [["bufferBefore", 0, 240], ["bufferAfter", 0, 240], ["notice", 0, 43200], ["horizon", 1, 90], ["maxDaily", 1, 50], ["maxMinutes", 5, 1440], ["longThreshold", 5, 240], ["longBreak", 0, 120]]) if (value[key] !== void 0) result[key] = integer(value[key], min, max);
  if (value.preferred !== void 0) {
    if (!["earliest", "morning", "afternoon"].includes(value.preferred)) reject(400, "invalid_preference", "Choose a supported preference.");
    result.preferred = value.preferred;
  }
  if (value.focus !== void 0) result.focus = windows(value.focus);
  if (value.embedOrigins !== void 0) {
    if (!Array.isArray(value.embedOrigins) || value.embedOrigins.length > 10) reject(400, "invalid_embed", "Choose up to ten exact HTTPS parent origins.");
    result.embedOrigins = value.embedOrigins.map((v) => {
      try {
        const u = new URL(v);
        if (u.origin !== v || u.protocol !== "https:" || u.username || u.password) throw 0;
        return v;
      } catch {
        reject(400, "invalid_embed", "Use exact HTTPS parent origins.");
      }
    });
  }
  return result;
}
function questions(value = []) {
  if (!Array.isArray(value) || value.length > 10) reject(400, "invalid_questions", "Choose up to ten questions.");
  const seen = /* @__PURE__ */ new Set();
  return value.map((q) => {
    if (!q || typeof q !== "object") reject(400, "invalid_questions", "Choose valid questions.");
    const id = text(q.id, 40);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || seen.has(id)) reject(400, "invalid_questions", "Question IDs must be unique and safe.");
    seen.add(id);
    if (!["short", "long", "single", "multiple"].includes(q.type) || typeof q.required !== "boolean") reject(400, "invalid_questions", "Choose a valid question type.");
    const choices = ["single", "multiple"].includes(q.type) ? Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.length <= 12 ? q.choices.map((c) => text(c, 120)) : reject(400, "invalid_questions", "Choice questions need two to twelve choices.") : [];
    if (new Set(choices).size !== choices.length) reject(400, "invalid_questions", "Choices must be unique.");
    return { id, label: text(q.label, 300), type: q.type, required: q.required, choices };
  });
}
function answers(schema, values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some((k) => !schema.some((q) => q.id === k))) reject(400, "invalid_answers", "Answers do not match this event.");
  const result = {};
  for (const q of schema) {
    const v = values[q.id];
    if (v === void 0 || v === "" || Array.isArray(v) && v.length === 0) {
      if (q.required) reject(400, "answer_required", "Please complete all required questions.");
      continue;
    }
    if (q.type === "multiple") {
      if (!Array.isArray(v) || v.length > q.choices.length || v.some((c) => !q.choices.includes(c)) || new Set(v).size !== v.length) reject(400, "invalid_answers", "Choose valid answers.");
      result[q.id] = v;
    } else {
      const t = text(v, q.type === "long" ? 4e3 : q.type === "short" ? 300 : 120);
      if (q.type === "single" && !q.choices.includes(t)) reject(400, "invalid_answers", "Choose a valid answer.");
      result[q.id] = t;
    }
  }
  return result;
}
export {
  answers,
  email,
  integer,
  questions,
  reject,
  settings,
  text,
  windows,
  zone
};
