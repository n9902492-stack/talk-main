import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMeetingHistory, meetingHistorySummary, type HistoryMeeting, type MeetingHistoryFilters } from '../frontend/src/lib/meetingHistory';

const now = Date.UTC(2026, 9, 18, 12);
const day = 86_400_000;
const meetings: HistoryMeeting[] = [
  { id: 'a', title: 'Weekly Design Review', hostName: 'Nikhil', createdAt: now - day, endedAt: null, participantCount: 1, recordingCount: 0, transcriptCount: 0 },
  { id: 'b', title: 'Client Handoff', hostName: 'Riya', createdAt: now - 7 * day, endedAt: now - 6 * day, participantCount: 4, recordingCount: 2, transcriptCount: 1 },
  { id: 'c', title: 'टीम समीक्षा', hostName: 'Nikhil', createdAt: now - 31 * day, endedAt: now - 30 * day, recordingCount: 1, transcriptCount: 0 },
];
const defaults: MeetingHistoryFilters = { query: '', kind: 'all', dateRange: 'all', host: '', sort: 'newest' };
const filter = (changes: Partial<MeetingHistoryFilters>) => filterMeetingHistory(meetings, { ...defaults, ...changes }, now).map(item => item.id);

test('search finds title/host terms and Hindi text without treating content as markup', () => {
  assert.deepEqual(filter({ query: '  DESIGN nikhil  ' }), ['a']);
  assert.deepEqual(filter({ query: 'टीम' }), ['c']);
  assert.deepEqual(filter({ query: '<script>' }), []);
});

test('date boundaries and combined content/host/status filters remain independent', () => {
  assert.deepEqual(filter({ dateRange: '7' }), ['a', 'b']);
  assert.deepEqual(filter({ dateRange: '30', kind: 'recordings' }), ['b']);
  assert.deepEqual(filter({ kind: 'transcripts', host: 'Nikhil' }), []);
  assert.deepEqual(filter({ kind: 'open' }), ['a']);
  assert.deepEqual(filter({ kind: 'ended', host: 'Nikhil' }), ['c']);
});

test('sort returns a stable copy and never changes backend order or meeting records', () => {
  const before = structuredClone(meetings);
  assert.deepEqual(filter({ sort: 'oldest' }), ['c', 'b', 'a']);
  assert.deepEqual(filterMeetingHistory([{ ...meetings[0], id: 'z' }, { ...meetings[0], id: 'a' }], defaults, now).map(item => item.id), ['a', 'z']);
  assert.deepEqual(meetings, before);
});

test('summaries count available segments without inventing live attendees or scheduled meetings', () => {
  assert.deepEqual(meetingHistorySummary(meetings), { meetings: 3, open: 1, ended: 2, recordings: 3, transcripts: 1 });
  assert.deepEqual(meetingHistorySummary([]), { meetings: 0, open: 0, ended: 0, recordings: 0, transcripts: 0 });
});
