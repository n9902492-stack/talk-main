import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTalkMeetingLink } from '../frontend/src/lib/meetingLink';

const origin = 'https://talk.example.test';
const meetingId = 'm-92b5101c-63a5-47a4-81e8-7eec3c52e12b';

test('accepts existing backend meeting IDs and trims surrounding input', () => {
  for (const id of ['talk-workshop', meetingId]) {
    assert.equal(parseTalkMeetingLink(id, origin), id);
    assert.equal(parseTalkMeetingLink(`  ${id}  `, origin), id);
  }
  for (const value of ['', ' ', 'daily-standup', 'm-123', meetingId.toUpperCase(), `${meetingId}/extra`]) {
    assert.equal(parseTalkMeetingLink(value, origin), null, value);
  }
});

test('extracts only the room from existing same-origin meeting and pre-join routes', () => {
  for (const pathname of ['/device-test', '/test', '/meeting']) {
    const relative = `${pathname}?room=${meetingId}`;
    assert.equal(parseTalkMeetingLink(relative, origin), meetingId);
    assert.equal(parseTalkMeetingLink(origin + relative, origin), meetingId);
  }
  assert.equal(parseTalkMeetingLink(`${origin}/meeting?live=1&room=${meetingId}`, origin), meetingId);
  assert.equal(parseTalkMeetingLink(`/device-test?room=${encodeURIComponent('talk-workshop')}`, origin), 'talk-workshop');
});

test('supports the exact local HTTP origin without trusting other hosts or ports', () => {
  const local = 'http://127.0.0.1:3002';
  assert.equal(parseTalkMeetingLink(`${local}/device-test?room=${meetingId}`, local), meetingId);
  for (const foreign of ['http://localhost:3002', 'http://127.0.0.1:3001', 'https://127.0.0.1:3002']) {
    assert.equal(parseTalkMeetingLink(`${foreign}/device-test?room=${meetingId}`, local), null, foreign);
  }
});

test('rejects foreign links, authority tricks and credentials even when a room looks valid', () => {
  for (const value of [
    `https://other.example.test/device-test?room=${meetingId}`,
    `https://talk.example.test.attacker.test/device-test?room=${meetingId}`,
    `https://talk.example.test@attacker.test/device-test?room=${meetingId}`,
    `https://name:password@talk.example.test/device-test?room=${meetingId}`,
    `https://name@talk.example.test/device-test?room=${meetingId}`,
    `http://talk.example.test/device-test?room=${meetingId}`,
    `//talk.example.test/device-test?room=${meetingId}`,
    `//attacker.test/device-test?room=${meetingId}`,
  ]) assert.equal(parseTalkMeetingLink(value, origin), null, value);
});

test('rejects non-web protocols and unsupported pages without defaulting to another room', () => {
  for (const value of [
    `javascript:alert(1)?room=${meetingId}`,
    `data:text/html,hello?room=${meetingId}`,
    `file:///device-test?room=${meetingId}`,
    `wss://talk.example.test/meeting?room=${meetingId}`,
    `device-test?room=${meetingId}`,
    `/dashboard?room=${meetingId}`,
    `/meeting-history/${meetingId}`,
    `/api/auth/meetings/${meetingId}`,
    `/device-test/extra?room=${meetingId}`,
    '/device-test', '/meeting?live=1', '/test?room=',
  ]) assert.equal(parseTalkMeetingLink(value, origin), null, value);
});

test('requires exactly one valid room parameter, including encoded duplicates', () => {
  for (const value of [
    `/device-test?room=${meetingId}&room=${meetingId}`,
    `/device-test?room=${meetingId}&room=talk-workshop`,
    `/device-test?room=${meetingId}&%72oom=talk-workshop`,
    `/device-test?room=${meetingId}&room=`,
    '/device-test?room=not-a-talk-meeting',
    `/device-test?room=${meetingId}%2Fextra`,
    `/device-test?room=${meetingId}%00`,
    `/device-test?room=${meetingId}%0A`,
    `/device-test?room=${meetingId}%20`,
    '/device-test?room=%3Cscript%3E',
  ]) assert.equal(parseTalkMeetingLink(value, origin), null, value);
});

test('rejects embedded whitespace, controls and backslashes before URL normalization', () => {
  for (const value of [
    `m-92b5101c-63a5-47a4-81e8-7eec3c52e12 b`,
    `${origin}/device-\ntest?room=${meetingId}`,
    `${origin}/device-\ttest?room=${meetingId}`,
    `${origin}/device-test?room=\r${meetingId}`,
    `${origin}/device-test?room=${meetingId}\u0000`,
    `${origin}/device-test?room= ${meetingId}`,
    `https:\\talk.example.test\\device-test?room=${meetingId}`,
    `/\\attacker.test/device-test?room=${meetingId}`,
  ]) assert.equal(parseTalkMeetingLink(value, origin), null, JSON.stringify(value));
});

test('enforces a bounded pasted link length', () => {
  const prefix = `/device-test?room=${meetingId}&padding=`;
  assert.equal(parseTalkMeetingLink(prefix + 'a'.repeat(2049 - prefix.length), origin), null);
});
