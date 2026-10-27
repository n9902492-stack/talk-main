const escape = (v) => String(v).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calendarInvitation({ id, title, start, end, version = 1, cancelled = false }) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Talk//Scheduling//EN", "CALSCALE:GREGORIAN", `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`, "BEGIN:VEVENT", `UID:${escape(id)}@talk.local`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SEQUENCE:${version}`, `SUMMARY:${escape(title)}`, `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`, "DESCRIPTION:Open your private Talk booking confirmation to join.", "END:VEVENT", "END:VCALENDAR"];
  return lines.map((line) => {
    let out = "", bytes = 0;
    for (const char of line) {
      const n = Buffer.byteLength(char);
      if (bytes + n > 73) {
        out += "\r\n ";
        bytes = 1;
      }
      out += char;
      bytes += n;
    }
    return out;
  }).join("\r\n") + "\r\n";
}
const calendarProvider = Object.freeze({ provider: "ics", externalSyncEnabled: false, connect: () => {
  throw new Error("External calendar authorization is not enabled.");
} });
export {
  calendarInvitation,
  calendarProvider
};
