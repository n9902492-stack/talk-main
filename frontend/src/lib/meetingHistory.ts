export type HistoryMeeting = {
  id: string;
  title: string;
  createdAt: number;
  endedAt?: number | null;
  hostName: string;
  participantCount?: number;
  recordingCount?: number;
  transcriptCount?: number;
};

export type MeetingHistoryFilters = {
  query: string;
  kind: 'all' | 'open' | 'ended' | 'recordings' | 'transcripts';
  dateRange: 'all' | '7' | '30' | '90';
  host: string;
  sort: 'newest' | 'oldest' | 'title';
};

export const isEndedMeeting = (meeting: HistoryMeeting) => meeting.endedAt != null;
const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
const searchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

// These totals describe only the authorized records returned by the history API
// (currently the latest 100 host/co-host rooms), not all-time workspace metrics.
export function meetingHistorySummary(meetings: readonly HistoryMeeting[]) {
  return meetings.reduce((summary, meeting) => ({
    meetings: summary.meetings + 1,
    open: summary.open + (isEndedMeeting(meeting) ? 0 : 1),
    ended: summary.ended + (isEndedMeeting(meeting) ? 1 : 0),
    recordings: summary.recordings + count(meeting.recordingCount),
    transcripts: summary.transcripts + count(meeting.transcriptCount),
  }), { meetings: 0, open: 0, ended: 0, recordings: 0, transcripts: 0 });
}

export function filterMeetingHistory(meetings: readonly HistoryMeeting[], filters: MeetingHistoryFilters, now = Date.now()) {
  const terms = searchText(filters.query.trim()).split(/\s+/u).filter(Boolean);
  const cutoff = filters.dateRange === 'all' ? -Infinity : now - Number(filters.dateRange) * 86_400_000;
  return meetings.filter(meeting => {
    const text = searchText(`${meeting.title} ${meeting.hostName}`);
    return terms.every(term => text.includes(term))
      && (filters.host === '' || meeting.hostName === filters.host)
      && meeting.createdAt >= cutoff
      && (filters.kind === 'all'
        || filters.kind === 'open' && !isEndedMeeting(meeting)
        || filters.kind === 'ended' && isEndedMeeting(meeting)
        || filters.kind === 'recordings' && count(meeting.recordingCount) > 0
        || filters.kind === 'transcripts' && count(meeting.transcriptCount) > 0);
  }).sort((a, b) => {
    const order = filters.sort === 'title' ? a.title.localeCompare(b.title)
      : filters.sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    return order || a.id.localeCompare(b.id);
  });
}

// Room creation/end timestamps describe room lifetime, not active call duration.
export function formatMeetingDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 60_000));
  if (!minutes) return 'Less than a minute';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}
