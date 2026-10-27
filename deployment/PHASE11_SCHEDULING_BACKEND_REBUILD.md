# Phase 11 scheduling backend rebuild

Validated locally on 22 October 2026. No deployment, paid service, real notification delivery or Gemini request was performed.

Follow-on implementation: [booking invitations and reminder emails](PHASE11_EMAIL_INVITATIONS_REMINDERS.md) adds role-specific secure email links, meeting-day/15-minute reminders and migration 015/013. The audit and test counts below describe the initial rebuild.

## Delivered behavior

The browser-only booking demonstration has been replaced by authenticated scheduling settings and real database-backed public bookings. Hosts can configure a custom handle, timezone, weekly hours, date-specific hours, holidays, buffers, notice, booking horizon, daily count/minute limits, focus periods and long-meeting breaks. Hosts create event types with duration, group capacity, qualification questions and follow-up duration, and can pause new bookings without losing existing appointments.

Public pages calculate real availability, detect the browser timezone with manual override, suggest available times, accept qualification responses, confirm bookings, export ICS, and support private cancellation/rescheduling. The dashboard reads actual bookings. Its sidebar order is Dashboard, Bookings, Meetings, Meeting History. Scheduling instructions use a deterministic editable parser, with ambiguities shown for review; no AI provider runs.

Bookings associate a future Talk meeting record. They do not create a LiveKit media room or include permanent media tokens in links. Guest joining requires possession of the private booking credential, fresh email proof, a meeting-scoped session, an allowed join window and existing host admission. Guest sessions grant no access to account dashboards, recordings, transcripts, AI reports or saved whiteboards. Existing normal account authentication remains authoritative.

## Audit and recoverable backup

The initial branch was `main`, at `edb20ff39064f97b5b8ab3984fdeca0b470383aa`. The working tree already contained substantial unrelated changes and untracked phase implementations; no reset, clean, stash or blanket commit was used.

The old implementation was `frontend/src/pages/Booking.tsx`, with fixed dates/times, a fixed timezone and browser `sessionStorage` persistence. Dashboard consumed `readSavedDemo()` from `workspacePreview.ts`. No booking routes, repositories or scheduling tables existed in the inspected local database. Existing demo browser storage was left intact and was not converted into confirmed bookings.

Source backup: `artifacts/backups/phase11-20261022-194139/`. `files.txt` inventories 28 original files; `manifest.json` contains SHA-256 checksums. `working-tree.txt` and `head.txt` record the initial checkout. This is a source backup, not a database backup. It excludes private environment files. The backup directory is Git-ignored.

Only the obsolete booking page was replaced. Shared files received targeted integration edits. No existing user, meeting, recording, transcript or whiteboard rows were deleted.

## Files and architecture

New backend modules under `backend/src/scheduling/`:

| File | Responsibility |
| --- | --- |
| `routes.mjs` | Thin HTTP controllers, host/guest authorization, CSRF/origin checks, request limits and embed headers |
| `service.mjs` | Profiles, event types, booking transactions, cancellation/rescheduling, private details and analytics |
| `repository.mjs` | Existing async database adapter and host-scoped transaction locks |
| `availability.mjs` | IANA/DST-aware availability, conflicts, capacity, time protection and suggestions |
| `validation.mjs` | Bounded fields, safe question IDs, answers, zones, windows, limits and exact embed origins |
| `parser.mjs` | Deterministic configuration parsing; external AI adapter disabled |
| `guests.mjs` | Email proof, revocable invitations, scoped sessions/tickets, admission and moderation |
| `jobs.mjs` | Durable reminder outbox, leases, retries, recovery and retention cleanup |
| `calendar.mjs` | Escaped, folded UTC ICS generation; external calendar adapter disabled |
| `transport.mjs` | Explicitly opt-in existing SMTP adapter; disabled by default |

New frontend files: `pages/Scheduling.tsx`, `pages/PublicBooking.tsx`, `lib/scheduling.ts`, `styles/scheduling.css`. `pages/Booking.tsx` now exports the real scheduling page.

Targeted integrations: `backend/src/auth.mjs`, `runtime-auth.mjs`, `meeting-management.mjs`, `meeting-recordings.mjs`; frontend `AppRouter.tsx`, `Dashboard.tsx`, `DeviceTest.tsx`, `LiveMeeting.tsx`, `useMeetingManagement.ts`, `meetingSession.ts`, `workspaceNavigation.ts`, `workspacePreview.ts`. Existing meeting gateway code is reused. Scripts, fixtures, migration-count assertions and the old demo browser check were updated to match the new implementation. `.env.example` documents disabled scheduling email; `.gitignore` protects the source checkpoint.

New tests: `tests/scheduling.test.mjs`, `scheduling-server.test.mjs`, `scheduling-browser.mjs`, `production-scheduling.test.mjs`, and `tests/helpers/scheduling.mjs`.

## Additive migrations and persistence

SQLite: `backend/src/migrations/013_scheduling.sql`, `014_scheduling_metrics.sql`.

PostgreSQL: `backend/src/postgres-migrations/011_scheduling.sql`, `012_scheduling_metrics.sql`.

Tables cover profiles, event types, weekly windows, date overrides/holidays, occurrences, bookings, attendees, invitation credentials, guest sessions/connections, questions/answers, reminder jobs, audit events, local ICS connections, anonymous form challenges, consented page metrics and conversions. Foreign keys, indexes, scoped uniqueness, checks and an active-occurrence partial unique index protect associations. Migration 014/012 adds anonymous conversion storage separately so previously applied base scheduling migrations remain compatible.

Main local `data/talk.sqlite` has both SQLite migrations. Read-only inspection confirmed the separate `data/tunnel-test/talk.sqlite` has neither scheduling migration. Main PostgreSQL was not contacted or migrated.

Bookings use the existing SQLite transaction serialization and `BEGIN IMMEDIATE`; PostgreSQL uses a transaction-scoped advisory lock per host. Availability is rechecked inside the transaction. Group reservations share one occurrence/meeting up to capacity. A hashed client credential provides creation idempotency; reusing it for different details fails. Version checks protect cancellation/rescheduling, which revoke old invitations/sessions/tickets and supersede reminder jobs. Cancellation retains history and meeting records. SQLite close/reopen persistence is tested.

## HTTP API

Prefix: `/api/auth/scheduling`.

| Access | Endpoints |
| --- | --- |
| Verified host | `GET /dashboard`, `POST /profile`, `POST /events`, `POST /events/:id/manage`, `POST /parse`, `GET /analytics`, `GET /host-booking/:id`, `POST /host-booking/:id/change` |
| Public read | `GET /form`, `GET /public/:host/:event`, `GET /events/:id/slots`, `GET /embed/:id` |
| Public form challenge + private credential where required | `POST /events/:id/book`, `/events/:id/metric`, `/booking/:id/detail`, `/booking/:id/change`, `/booking/:id/calendar`, `/booking/:id/code`, `/booking/:id/redeem` |
| Scoped guest session | `GET /guest/meetings/:id`, `/guest/meetings/:id/state`; `POST /guest/meetings/:id/token`, `/guest/meetings/:id/actions` |

Frontend routes: `/bookings`, `/booking/:host/:event`, `/booking-confirmation?id=...#private-credential`. API credentials are never placed in booking links. The private management credential is consumed from the fragment into per-tab session storage and removed from the address bar; retain the original private confirmation link. Rescheduling rotates that credential and supports recovery if a response is lost after commit.

## Security, consent and jobs

- Existing verified host sessions, CSRF, origin validation and backend resource authorization remain in force. Public writes require a short-lived random form challenge and valid origin; input bodies are bounded to 32 KB and scheduling requests are rate-limited.
- Management/invitation/session/ticket credentials are cryptographically random and stored as hashes. Email codes expire after five minutes, have bounded wrong attempts and a resend cooldown. One-time invitation redemption creates no permanent account.
- Guest cookies are HttpOnly, SameSite=Lax and scoped to the scheduling API; HTTPS runtimes set Secure. Guest sessions last at most four hours and cannot outlive the invitation. Join window: 15 minutes before the appointment through one hour after its end.
- Existing host/co-host admission and removal are reused. Guests cannot promote roles, moderate others, bypass admission or access private resource routes. Cancellation and removal invalidate access; media enforcement removes revoked guest connections.
- Booking guests currently have no recording-consent flow. Recording is blocked while they are admitted, and guest joining is blocked during active capture. Normal account recording consent is preserved.
- Qualification responses are host-only and expire 30 days after the appointment. Optional anonymous form metrics require consent and respect DNT/GPC. Form tokens are hashed, deduplicated and expire after 24 hours; page counts do not identify invitees. Attendance is counted from observed LiveKit presence, not ticket issuance.
- Embeds require exact host-approved HTTPS parent origins, CSP `frame-ancestors`, no-referrer policy and exact-origin/source message checks. Embedded confirmations open in a top-level tab for guest email/session handling.
- Reminder jobs are uniquely keyed by booking/version/kind, use leases and safe bounded retries (three attempts), recover expired leases and suppress cancelled/superseded jobs. Fixed message IDs assist deduplication. SMTP can still duplicate after an uncertain acknowledgement; exactly-once external delivery is not claimed.

Scheduling SMTP is **disabled** unless the operator explicitly sets `SCHEDULING_EMAIL_ENABLED=true` with valid existing SMTP configuration. Merely having authentication SMTP credentials does not activate this channel. Tests use mocked delivery only. ICS downloads and attachments work locally; Google/Outlook OAuth, external calendar busy-time sync and calendar token storage remain disabled foundations. No external tokens are stored.

The temporary tunnel constructs the auth application without scheduling enabled. Its environment file, credentials, allowlist, database records, frontend build and process were not changed or restarted. Normal Gemini Cloud AI and operator approval remain false. No authorized Gemini attempt was consumed.

## Validation results

| Check | Actual result |
| --- | --- |
| Scheduling unit/HTTP tests | 20 passed, 0 failed; included in the broad run below |
| Broad auth/meeting/recording/transcript/Phase 9/whiteboard/Phase 10I/scheduling suite | 236 passed, 0 failed, 0 skipped |
| Additional frontend/model/security regression suite | 86 passed, 0 failed, 2 skipped |
| Skips | Real local-model quality/inference not approved; no handwriting recognizer configured |
| TypeScript / repository lint (`npm run lint`) | Passed |
| Production frontend build (`npm run build:whiteboard`) | Passed; existing bundle-size/timing warnings remain |
| Scheduling browser workflow | Passed, using real local LiveKit, two isolated browser contexts, synthetic camera/microphone and mocked email |
| Existing waiting-room browser workflow | Passed: queue/privacy, outage recovery, real RTP, chat draft, mobile/denial |
| Existing three-browser whiteboard workflow | Passed: collaboration, real RTP, tools, persistence, reconnect, permissions, screen sharing, chat, exports and Meeting Details |
| Disposable PostgreSQL execution | UNVERIFIED: Docker Linux engine returns HTTP 500 before database startup |

The scheduling browser workflow verifies actual host UI, date-override persistence, public recommendations, booking database rows, mobile confirmation, ICS download, qualification-response viewing, OTP redemption, waiting-room admission, received audio packets and decoded video frames, synthetic tab screen sharing, data-channel chat, guest reconnect, actual attendance and removal. It verifies that booking alone creates **no** LiveKit room. These are local synthetic tests, not physical-device or separate-network validation.

Evidence: `artifacts/qa/phase11-regression.tap`, `phase11-additional-regression.tap`, `phase11-scheduling.tap`, `phase11-build.log`, `phase11-browser.log`, `phase11-browser-results.json`, `phase11-confirmation.png`, `phase11-waiting-room.log`, `phase11-whiteboard-browser.log`.

## Local manual verification

Open **http://localhost:3001/bookings** and sign in with an existing Talk account. The local server was verified responding; unauthenticated scheduling-dashboard access returns 401. Private environment-file paths return the SPA HTML, not environment contents.

1. Save a unique booking handle, valid IANA timezone, hours and notice. For an immediate local test, use zero notice and hours covering the current time. Add holidays/date overrides as needed.
2. Create an event type and required question; open its public booking page in a private browser window.
3. Choose a real slot, change the displayed timezone if needed, submit fictional details, and retain the private confirmation link. Verify the booking and responses in the host dashboard.
4. Download ICS, reschedule, reload and cancel a separate test booking. Check conflict/capacity behavior using two booking windows.
5. Real guest email is currently unavailable until scheduling SMTP is explicitly configured. Do not claim that a real email was sent. Automated guest tests used a mock transport. Once approved/configured, verify the booking email near the join window, check devices, request admission, then admit from the host's existing meeting controls.
6. Test with physical devices/networks separately before any public release. Do not expose the local development server or add scheduling to the existing tunnel without a separate review.

Repeatable checks: `npm run test:scheduling`, `npm run lint`, `npm run build:whiteboard`, `npm run test:scheduling:browser`. PostgreSQL command when the local Docker engine is repaired: `npm run test:scheduling:postgres`; it targets a disposable local test database, never production.

## Remaining limitations and release gates

This is a locally validated implementation, not a production release. PostgreSQL concurrency/migrations must execute successfully before production readiness can be claimed. Real SMTP delivery, mailbox behavior and external calendar integration have not been exercised. The weekly-hours editor applies common hours across checked weekdays; the backend also supports multiple per-day windows, and date-specific split hours are editable. Event types can be created and paused/resumed; editing their duration/questions after creation is not exposed in this iteration. Host APIs support rescheduling; the public private-confirmation UI provides the reschedule flow.

The dashboard displays up to 200 booking records. External busy calendars, recurring booking series, round-robin hosts, advanced calendar webhooks and production worker monitoring are not implemented. Follow-up links use an enabled matching-duration event when published; otherwise they explicitly show that the original event duration applies. The follow-on email implementation now includes purpose-bound private invitation links; see its report for activation requirements. Cancellation does not recall an email already in flight or automatically remove an imported external calendar item.

## Rollback

1. Keep the checkpoint and take a fresh backup of current source and the applicable local database before rollback. Never overwrite later user edits blindly.
2. Stop only the normal local application being rolled back; leave Cloudflare/tunnel processes alone. Compare changed application files against the matching checkpoint copies listed in `files.txt` and restore only Phase 11 integration changes. Restoring the old `Booking.tsx` reverts to the prior demo, not a working scheduling service.
3. Restore the prior route/runtime/frontend hooks together. New scheduling files can remain on disk unused; keep the backup ignore rule. Keep migration-count test assertions consistent with the migrations present rather than restoring obsolete counts.
4. **Do not roll back/drop scheduling tables or remove existing bookings, meetings or migration history.** The schema is additive and the previous application can ignore it. Retain new data for a future forward fix.
5. Restart only the normal local app, verify sign-in/meetings, and rerun relevant regressions. No blanket `git reset`, recursive project deletion or production migration rollback is required.
