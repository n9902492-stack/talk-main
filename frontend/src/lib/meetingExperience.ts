export function meetingGridColumns(count: number, width: number, height: number) {
  if (count <= 1) return 1;
  const maximum = Math.min(count, width < 560 ? 2 : width < 950 ? 3 : 6);
  let best = 1, area = 0;
  for (let columns = 1; columns <= maximum; columns++) {
    const rows = Math.ceil(count / columns);
    const tileWidth = Math.max(1, (width - (columns - 1) * 12) / columns);
    const tileHeight = Math.max(1, (height - (rows - 1) * 12) / rows);
    const fittedWidth = Math.min(tileWidth, tileHeight * 16 / 10);
    const candidate = fittedWidth * fittedWidth / 1.6;
    if (candidate > area) { area = candidate; best = columns; }
  }
  return best;
}

export function meetingHostIdentity(participants: { identity: string; role?: string }[]) {
  return participants.find(participant => participant.role === 'host')?.identity || '';
}

export const chatTopic = 'talk.chat.v1';
export const chatMaxLength = 2000;
export const chatHistoryLimit = 500;
export type ChatPacket = { version: 1; id: string; text: string; sentAt: number; clock: number };
export type MeetingChatMessage = ChatPacket & { senderIdentity: string; senderName: string; local: boolean; status: 'sending' | 'sent' | 'received' | 'failed' };

export function cleanChatText(text: string) {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}

export function decodeChatPacket(bytes: Uint8Array, now = Date.now()): ChatPacket | null {
  if (bytes.byteLength > 12000) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value?.version !== 1 || typeof value.id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.id)
      || typeof value.text !== 'string' || value.text.length > chatMaxLength || !Number.isSafeInteger(value.clock) || value.clock < 1 || value.clock > 1000000000
      || !Number.isFinite(value.sentAt)) return null;
    const text = cleanChatText(value.text);
    if (!text) return null;
    // The sender cannot supply identity/name or use an unbounded timestamp.
    return { version: 1, id: value.id, text, clock: value.clock, sentAt: Math.abs(value.sentAt - now) <= 5 * 60000 ? value.sentAt : now };
  } catch { return null; }
}

export function mergeChatMessage(messages: MeetingChatMessage[], message: MeetingChatMessage) {
  const key = `${message.senderIdentity}:${message.id}`;
  const index = messages.findIndex(item => `${item.senderIdentity}:${item.id}` === key);
  const next = index < 0 ? [...messages, message] : messages.map((item, position) => position === index ? { ...item, status: message.status } : item);
  return next.sort((left, right) => left.clock - right.clock || left.senderIdentity.localeCompare(right.senderIdentity) || left.id.localeCompare(right.id)).slice(-chatHistoryLimit);
}
