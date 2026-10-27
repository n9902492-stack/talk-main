import { useEffect, useRef, useState } from 'react';
import { ConnectionState, RoomEvent, type RemoteParticipant, type Room } from 'livekit-client';
import { chatMaxLength, chatTopic, cleanChatText, decodeChatPacket, mergeChatMessage, type ChatPacket, type MeetingChatMessage } from '../lib/meetingExperience';

export function useMeetingChat(room: Room | null, open: boolean) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open); openRef.current = open;
  const clock = useRef(0);
  const seen = useRef(new Set<string>());
  const recent = useRef(new Map<string, { start: number; count: number }>());
  const sending = useRef(new Set<string>());
  const localSends = useRef<number[]>([]);
  useEffect(() => { if (open) setUnread(0); }, [open]);
  useEffect(() => {
    if (!room) return;
    let active = true;
    const receive = (bytes: Uint8Array, sender?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!active || topic !== chatTopic || !sender || !room.remoteParticipants.has(sender.identity)) return;
      const packet = decodeChatPacket(bytes);
      if (!packet) return;
      const key = `${sender.identity}:${packet.id}`;
      if (seen.current.has(key)) return;
      const now = Date.now();
      let bucket = recent.current.get(sender.identity);
      if (!bucket || bucket.start + 10000 <= now) { bucket = { start: now, count: 0 }; recent.current.set(sender.identity, bucket); }
      if (++bucket.count > 20) return;
      seen.current.add(key);
      if (seen.current.size > 2000) seen.current.delete(seen.current.values().next().value!);
      clock.current = Math.max(clock.current, packet.clock);
      setMessages(previous => mergeChatMessage(previous, { ...packet, senderIdentity: sender.identity, senderName: sender.name || 'Talk member', local: false, status: 'received' }));
      if (!openRef.current) setUnread(value => Math.min(99, value + 1));
    };
    const disconnected = () => { if (active) setMessages(previous => previous.map(message => message.status === 'sending' ? { ...message, status: 'failed' } : message)); };
    const participantLeft = (participant: RemoteParticipant) => { recent.current.delete(participant.identity); };
    room.on(RoomEvent.DataReceived, receive).on(RoomEvent.Disconnected, disconnected).on(RoomEvent.ParticipantDisconnected, participantLeft);
    return () => { active = false; room.off(RoomEvent.DataReceived, receive).off(RoomEvent.Disconnected, disconnected).off(RoomEvent.ParticipantDisconnected, participantLeft); };
  }, [room]);

  const send = async (retry?: MeetingChatMessage) => {
    setError('');
    const text = cleanChatText(retry?.text || draft);
    if (!text || text.length > chatMaxLength) { setError(`Enter a message between 1 and ${chatMaxLength} characters.`); return false; }
    if (!room || room.state !== ConnectionState.Connected) { setError('Wait until the meeting reconnects before sending. Your draft is kept.'); return false; }
    const now = Date.now();
    localSends.current = localSends.current.filter(time => time > now - 10000);
    if (localSends.current.length >= 20) { setError('Please wait a moment before sending more messages.'); return false; }
    const sameSender = retry?.senderIdentity === room.localParticipant.identity;
    if (!sameSender) clock.current = Math.min(1000000000, clock.current + 1);
    const packet: ChatPacket = sameSender ? { version: 1, id: retry.id, text, clock: retry.clock, sentAt: retry.sentAt }
      : { version: 1, id: crypto.randomUUID(), text, clock: clock.current, sentAt: now };
    if (sending.current.has(packet.id)) return false;
    sending.current.add(packet.id); localSends.current.push(now);
    const message: MeetingChatMessage = { ...packet, local: true, senderIdentity: room.localParticipant.identity, senderName: room.localParticipant.name || 'You', status: 'sending' };
    setMessages(previous => mergeChatMessage(retry && !sameSender ? previous.filter(item => item !== retry) : previous, message));
    if (!retry) setDraft('');
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(packet)), { reliable: true, topic: chatTopic });
      if (room.state !== ConnectionState.Connected) throw new Error('Disconnected while sending');
      setMessages(previous => mergeChatMessage(previous, { ...message, status: 'sent' }));
      return true;
    } catch {
      setMessages(previous => mergeChatMessage(previous, { ...message, status: 'failed' }));
      setError('This message could not be sent. Reconnect and choose Send again.'); return false;
    } finally { sending.current.delete(packet.id); }
  };
  return { messages, draft, setDraft, error, unread, send };
}
