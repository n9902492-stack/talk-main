const meetingIdPattern = /^(?:talk-workshop|m-[a-f\d-]{36})$/;
const meetingPaths = new Set(['/device-test', '/test', '/meeting']);

// Extract only the room ID. Never navigate to a pasted URL or carry its other
// parameters into the pre-join flow; the backend still decides meeting access.
export function parseTalkMeetingLink(value: string, origin: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(input)) return null;
  if (meetingIdPattern.test(input)) return input;
  if (!/^https?:\/\//i.test(input) && !/^\/(?!\/)/.test(input)) return null;
  try {
    const base = new URL(origin);
    const url = new URL(input, base.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin
      || url.username || url.password || !meetingPaths.has(url.pathname)) return null;
    const rooms = url.searchParams.getAll('room');
    return rooms.length === 1 && meetingIdPattern.test(rooms[0]) ? rooms[0] : null;
  } catch { return null; }
}
