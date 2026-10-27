# Phase 9B: private AI meeting-assistant foundation

This phase adds backend storage, consent, evidence validation and durable report
jobs. It does not install Ollama, download a model, enable inference, add report
UI/export screens or deploy anything. No private transcript is sent externally.

The separate Cloudflare team-test adapter explicitly passes `assistant: false`.
Its existing route allowlist also denies the new APIs. Do not restart it, modify
`.env.tunnel-test.local`, apply migrations to its running database or publish a
new frontend as part of installing this foundation.

## Modules and migrations

- `backend/src/transcript-revisions.mjs`: canonical SHA-256 transcript snapshots.
- `backend/src/meeting-assistant.mjs`: eligibility, permission checks, lifecycle,
  revisions, audit, leases, retries, cancellation and retention.
- `backend/src/assistant-grounding.mjs`: strict structured report/evidence schema.
- `backend/src/assistant-provider.mjs`: non-inferencing Ollama boundary.
- `backend/src/assistant-routes.mjs`: authenticated API routes.
- SQLite `008_meeting_assistant.sql` and PostgreSQL
  `006_meeting_assistant.sql`: seven additive tables and immutability triggers.

The tables are `talk_transcript_revisions`, `talk_ai_consents`, `talk_ai_reports`,
`talk_ai_report_sources`, `talk_ai_report_revisions`, `talk_ai_jobs` and
`talk_ai_events`. Evidence is stored inside the validated immutable report JSON.
The existing SQLite-to-PostgreSQL importer preserves these tables in dependency
order. No new database engine, message broker or cloud service is required.

SQLite applies migrations when a normal application database is next opened.
Production PostgreSQL requires the existing explicit migration process before a
future application upgrade; no live production migration is performed here.

## Transcript versions and evidence

Successful Whisper completion snapshots the transcript in its existing meeting
transaction. Previously completed transcripts are versioned lazily on authorized
reads. Identical canonical data reuses the current version; changed text,
language, speaker metadata, segment identity or timestamps creates a new version.
Database triggers reject updates to transcript and report revisions.

Existing transcript fields remain available. The API additionally returns
`segments[].segmentId` and `revision: { id, number, contentHash, createdAt,
expiresAt }`. Segment timestamps are relative to the cited recording, not to a
fictional continuous meeting timeline.

Each report statement has evidence with `recordingId`, `revisionId`, `segmentId`,
`startMs`, `endMs` and an exact source quotation. All ten report sections are
supported: summary, topics, employee updates, completed work, work in progress,
blockers, risks, decisions, action items and follow-up notes. Speakers, owners and
deadlines are explicitly nullable. A name on the participant roster is not speaker
evidence. Non-null owner/deadline candidates must appear in the quotation and
remain marked for review.

Mechanical validation verifies references and quotations, not semantic truth.
Every generated conclusion is marked for review. Manager approval is explicit;
generation never changes a report directly to Approved.

## Explicit AI consent

`talk-ai-v1` explains local processing into private manager-facing drafts. It is
separate from `talk-recording-v1`. Every recorded consenting participant must
accept AI processing for the exact transcript revision. Historical recording
permission never implies AI permission. Missing original consent fails closed.

Consent is self-service: a host cannot submit permission for another account.
Participants may obtain only their own notice/revision/decision metadata through
the consent endpoint; that does not grant transcript or report access. A new
transcript version requires new AI permission. Decisions are stored and audited
without logging transcript bodies. Withdrawal immediately cancels affected jobs
and removes stored report content/checkpoints.

## Private API

All paths start with `/api/auth`. Reads require the existing verified, confirmed
Talk session. Writes additionally require exact Origin, JSON, session CSRF and
persistent account/IP limits. Private responses retain `Cache-Control: no-store`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/meetings/:id/ai-eligibility` | Source readiness, revision IDs and consent counts; optional repeated `recordingId` query |
| GET | `/recordings/:id/ai-consent` | Recorded participant's own AI notice and decision |
| POST | `/recordings/:id/ai-consent` | `{ revisionId, noticeVersion, decision }`; accept or decline for self |
| GET | `/meetings/:id/ai-reports` | Host/co-host report list |
| POST | `/meetings/:id/ai-reports` | Create empty Draft from `{ recordingIds }` after consent |
| GET | `/ai-reports/:id` | Private current report content and safe job metadata |
| POST | `/ai-reports/:id/revisions` | Save validated evidence-backed content with `expectedRevision` |
| POST | `/ai-reports/:id/generate` | Queue idempotent generation; currently returns 503 because Ollama is disabled |
| POST | `/ai-reports/:id/retry` | Explicitly retry an eligible failed job; also requires enabled provider |
| POST | `/ai-reports/:id/approve` | Meeting-owner approval with `expectedRevision` |
| POST | `/ai-reports/:id/cancel` | Cancel pending/running processing |
| POST | `/ai-reports/:id/delete` | Remove private report content and checkpoints |

Current admitted owners/co-hosts may create, read, edit, generate, cancel and
delete. Only the meeting owner may approve. Ordinary participants and revoked
co-hosts cannot access report content. Approved reports cannot be edited or
regenerated; create a separate draft instead. Optimistic revision checks prevent
an outdated editor from overwriting a newer draft.

## Jobs, recovery and retention

Report states are Draft, Processing, Review Required, Approved, Failed and
Cancelled. Jobs are Queued, Running, Completed, Failed or Cancelled.

Normal runtime initialization starts a bounded housekeeping/worker timer. The
disabled provider never claims inference jobs. An injected provider fixture is
used only in automated tests. One global database lease permits one inference
job at a time, across worker instances. Jobs defer while capture or Whisper is
actively processing. This is scheduling, not a CPU reservation.

Idempotency binds report/source hash, draft revision, requesting account, model
digest and prompt version. Each job records its requesting account separately
from the draft creator. Worker guards recheck that requester's current meeting
permissions before processing, checkpointing and committing results; an explicit
retry records the authorized retrier. Checkpoints are bounded, private and
retained only for resumable work.
Leases renew during work; expired/abandoned leases recover after restart. Retries
use bounded exponential backoff and stop after three failed attempts. Explicit
retry is authorized separately. Graceful shutdown aborts work and requeues its
checkpoint. Cancellation, stale leases, source changes and revoked permissions
prevent late results from being committed.

Deletion/retention hooks purge report JSON and checkpoint contents before source
snapshots are removed. Read/approval/worker guards also recheck live source
status, hashes, consent, retention and authority. A changed source cannot be
silently substituted beneath an older report. Copies already downloaded by an
authorized user cannot be recalled; exports are a later phase.

## Verification and next boundary

```powershell
npm run test:assistant
npm run test:assistant:postgres
npm run lint
```

The PostgreSQL runner requires an already cached `postgres:16-bookworm` image;
it will not pull one. It creates only a disposable, resource-limited local
container on loopback, uses random fixture credentials and removes that container.
It never loads application environment files or contacts a cloud database.

Provider fixtures prove infrastructure behavior, not summarization quality.
Real model inference, English/Hindi/Hinglish quality, long-transcript extraction
and hardware performance remain unbenchmarked. Ollama installation/model download
and benchmarking need separate approval. AI Notes, Action Items UI and report
PDF/TXT/Markdown exports are not part of this foundation phase.
