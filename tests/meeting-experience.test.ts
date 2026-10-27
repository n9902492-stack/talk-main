import assert from 'node:assert/strict';
import test from 'node:test';
import { chatHistoryLimit, chatMaxLength, cleanChatText, decodeChatPacket, meetingGridColumns, meetingHostIdentity, mergeChatMessage, type MeetingChatMessage } from '../frontend/src/lib/meetingExperience.ts';

const now = 1700000000000;
const packet = { version: 1, id: '10000000-0000-4000-8000-000000000001', text: 'Hello', clock: 1, sentAt: now };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const message = (clock: number, senderIdentity = 'alice'): MeetingChatMessage => ({ ...packet, version: 1, id: `10000000-0000-4000-8000-${String(clock).padStart(12, '0')}`, clock, senderIdentity, senderName: senderIdentity, local: false, status: 'received' });

test('grid fits 1, 2, 4, 9 and larger rooms into desktop/tablet/mobile bounds', () => {
  for (const count of [1, 2, 4, 9, 16, 25]) for (const [width, height] of [[1400, 700], [768, 650], [366, 560]]) {
    const columns = meetingGridColumns(count, width, height);
    assert.ok(columns >= 1 && columns <= count && columns <= (width < 560 ? 2 : width < 950 ? 3 : 6));
    assert.ok(Math.ceil(count / columns) * columns >= count);
  }
  assert.equal(meetingGridColumns(1, 1400, 700), 1);
  assert.equal(meetingGridColumns(4, 1400, 700), 2);
  assert.equal(meetingGridColumns(9, 1400, 700), 3);
});

test('host badge uses the backend role and never promotes the first remaining participant', () => {
  const alice = { identity: 'alice', role: 'host' }, bob = { identity: 'bob', role: 'member' };
  assert.equal(meetingHostIdentity([bob, alice]), 'alice');
  assert.equal(meetingHostIdentity([bob]), '');
  assert.equal(meetingHostIdentity([{ ...bob, role: 'cohost' }, alice]), 'alice');
  assert.equal(meetingHostIdentity([]), '');
});

test('chat rejects malformed, oversized, empty and unsupported payloads', () => {
  for (const change of [{ version: 2 }, { id: 'fake' }, { text: '' }, { text: ' \n ' }, { text: 'x'.repeat(chatMaxLength + 1) }, { text: 10 }, { clock: -1 }, { clock: 1.5 }, { clock: 1e12 }, { sentAt: null }]) {
    assert.equal(decodeChatPacket(encode({ ...packet, ...change }), now), null);
  }
  assert.equal(decodeChatPacket(new Uint8Array(12001), now), null);
  assert.equal(decodeChatPacket(new Uint8Array([255]), now), null);
  assert.equal(decodeChatPacket(new TextEncoder().encode('{'), now), null);
  assert.equal(decodeChatPacket(encode(null), now), null);
});

test('chat strips control/bidi characters, keeps text as text and ignores spoofed sender fields', () => {
  assert.equal(cleanChatText(' hi\u0000\u202e\nthere '), 'hi\nthere');
  const result = decodeChatPacket(encode({ ...packet, senderIdentity: 'host', senderName: 'Admin', text: '<img src=x onerror=alert(1)>' }), now)!;
  assert.equal(result.text, '<img src=x onerror=alert(1)>');
  assert.equal('senderIdentity' in result, false);
  assert.equal('senderName' in result, false);
  assert.equal(decodeChatPacket(encode({ ...packet, sentAt: 1e20 }), now)?.sentAt, now);
});

test('chat converges after out-of-order delivery and duplicate retry without rewriting content', () => {
  const items = [message(3), message(1), message(2, 'bob'), message(2)];
  const ordered = items.reduce(mergeChatMessage, [] as MeetingChatMessage[]);
  const reversed = [...items].reverse().reduce(mergeChatMessage, [] as MeetingChatMessage[]);
  assert.deepEqual(ordered, reversed);
  assert.deepEqual(ordered.map(item => item.clock), [1, 2, 2, 3]);
  const duplicate = mergeChatMessage(ordered, { ...ordered[0], text: 'changed', status: 'sent' });
  assert.equal(duplicate.length, 4); assert.equal(duplicate[0].text, 'Hello'); assert.equal(duplicate[0].status, 'sent');
});

test('chat history is bounded during a long session', () => {
  const messages = Array.from({ length: chatHistoryLimit + 20 }, (_, index) => message(index + 1)).reduce(mergeChatMessage, [] as MeetingChatMessage[]);
  assert.equal(messages.length, chatHistoryLimit); assert.equal(messages[0].clock, 21);
});
