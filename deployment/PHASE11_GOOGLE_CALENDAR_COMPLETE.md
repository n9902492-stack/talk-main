# Phase 11 — Google Calendar integration and offline booking verification

Date: 23 October 2026. Status: implemented for mock/local testing; live OAuth, Calendar reads/writes and attendee invitations remain disabled. No deployment, real Google authorization, Calendar event, email or OTP was performed.

## Existing implementation and preservation

The scheduler already persisted bookings, associated scheduled Talk meetings, enforced availability and guest proof/admission, generated ICS files and managed a durable email outbox. Its calendar provider supported local ICS only. There was no Google Calendar OAuth or synchronization worker to finish or reuse. The new integration keeps the existing ICS connection table and email/reminder system intact.

Existing Google Sign-In scopes and credentials were not changed. Calendar consent has separate backend configuration and a separate callback. Authentication, guest verification, LiveKit, recordings, transcription, whiteboards and Analytics were preserved. No start/restart command was issued for the main application, port 3003 or Cloudflare. No booking fixture was added to either existing database. Additive migrations are applied by the existing database migration mechanism; no application records are removed or rewritten.

Recoverable source backup: `artifacts/backups/google-calendar-20261023-215337/`. The working tree already contained substantial unrelated work; it was not reset, cleaned or committed.

## Architecture and files

New backend module: `backend/src/scheduling/google-calendar/`:

- `config.mjs`: strict origin/credential validation, trusted runtime origin check and independent live-operation gates.
- `vault.mjs`: AES-256-GCM authenticated encryption with purpose/host/connection binding and random IVs.
- `provider.mjs`: fixed Google endpoints, 15-second request deadlines, S256 PKCE and sanitized error codes; injectable mock provider.
- `connection.mjs`: session-bound, single-use, ten-minute OAuth state; encrypted refresh/access tokens; refresh leases; revocation/reconnect/disconnect handling. Disconnect or superseding consent invalidates a callback in flight.
- `repository.mjs`: booking lookup and transactional/idempotent outbox insertion.
- `event.mjs`: stable Google event IDs, reminder preferences, safe Talk joining URLs and comparison of Talk-managed fields.
- `worker.mjs`: durable outbound reconciliation, leases, bounded retries, conflict protection and notification gates.
- `incoming.mjs`: incremental Calendar reads, encrypted sync cursors, pagination, HTTP 410 recovery and busy/change detection.
- `service.mjs`: host ownership checks, sanitized booking sync state, manual addition and deliberate conflict resolution.
- `routes.mjs`: Calendar endpoints using existing account authentication, CSRF, origin validation, no-store responses and rate limiting.

Targeted backend changes: `backend/src/scheduling/service.mjs`, `backend/src/scheduling/routes.mjs`, `backend/src/runtime-auth.mjs`. Booking confirmation/rescheduling/cancellation queue Calendar work inside their existing transaction when Calendar configuration is present. Network requests happen afterward, never inside the booking transaction. The scheduler shutdown waits for the combined worker tick; SMTP and Calendar jobs remain separate.

Frontend changes: new `frontend/src/components/CalendarIntegration.tsx` and `frontend/src/styles/calendar-integration.css`; integrated into `frontend/src/pages/Scheduling.tsx` and `frontend/src/components/SchedulingBookingManagement.tsx`. An optional event agenda is persisted for Calendar descriptions. Existing 14px sidebar, 28px desktop/24px mobile headings, blue/white styling, navigation order and scheduling controls are retained.

Configuration/test tooling: `.env.example`, `package.json`, `scripts/test-production-postgres.mjs`, `scripts/prepare-calendar-offline-fixture.mjs`; new Google Calendar unit/HTTP/browser/PostgreSQL/fresh-fixture tests and mock helper. `tests/helpers/scheduling.mjs` accepts an injected Calendar adapter. Seven existing persistence tests now derive their expected SQLite migration count from `tests/helpers/migration-count.mjs` rather than a hardcoded 15.

## Database migrations

- SQLite: `backend/src/migrations/016_google_calendar.sql`.
- PostgreSQL: `backend/src/postgres-migrations/014_google_calendar.sql`.

Five additive tables: `talk_calendar_connections`, `talk_calendar_oauth_states`, `talk_calendar_events`, `talk_calendar_jobs`, `talk_calendar_conflicts`. They include account/booking foreign keys, state checks, event/job uniqueness constraints and expiry/due-job indexes. Existing scheduling, meeting, email and ICS tables are preserved. PostgreSQL uses BIGINT for millisecond timestamps.

The connection stores the authorized account, primary-calendar ID, settings, encrypted token/cursor material and last synchronization/error state. Event mappings store the stable event ID, event URL, booking version, etag, payload hash, sync status and attendee responses. Tokens never enter frontend JSON or application logs. The encryption key must stay backend-only and separate from the scheduling email-link secret.

Apply the production migration with the repository's existing migration command before enabling Calendar on an existing PostgreSQL installation. This work tested migrations only in disposable PostgreSQL and SQLite databases; no main PostgreSQL database was contacted.

## OAuth and Google Cloud Console setup still needed

Scopes: `https://www.googleapis.com/auth/calendar.events.owned`, plus `openid email` to identify the separately authorized Calendar account. No Calendar-list, Gmail, Contacts or broad free/busy scope is requested. This implementation targets the host's owned primary calendar.

Before a separately authorized live test:

1. Enable Google Calendar API in the intended Google project; configure its OAuth consent screen and approved test users.
2. Create/configure a Web Application OAuth client for Calendar separately from Talk Sign-In.
3. Register exactly `http://localhost:3001/api/auth/scheduling/google-calendar/callback` for local testing. A public test needs a separately approved HTTPS origin and its exact callback. Do not reuse an expired tunnel origin or change port 3003 for this purpose without approval.
4. Privately configure `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_TOKEN_KEY` (32 random bytes encoded as base64url), and `GOOGLE_CALENDAR_PUBLIC_URL`. The origin must also be trusted by the Talk runtime. Never prefix secrets with `VITE_`.
5. After approval, enable only `GOOGLE_CALENDAR_OAUTH_ENABLED` to test connection. Explicit separate approval is still required before enabling `GOOGLE_CALENDAR_SYNC_ENABLED`, `GOOGLE_CALENDAR_READ_ENABLED` or `GOOGLE_CALENDAR_INVITATIONS_ENABLED`.
6. Review one real event preview and notification recipients before any live write/invitation. Normal SMTP settings remain independent and disabled.

The UI provides a safe setup-pending state until configured. Connecting Calendar does not change Talk Sign-In. Callback state is bound to the current authenticated session and account; reconnect/disconnect does not issue a Talk session. Existing HTTPS deployments retain secure HttpOnly, SameSite=Lax session cookies and existing CSRF/origin protections. Calendar callback redirects remove authorization parameters and use no-store/no-referrer headers.

OAuth guidance: [Google web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth token-handling guidance](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth).

## Outbound event lifecycle

Confirmed booking → save Talk booking/meeting → queue durable job → leased worker reads the authoritative booking → reconcile a deterministic event ID → insert/PATCH/delete as appropriate → persist Google ID, etag and sync state.

The worker runs every 30 seconds when live writes are enabled. A host can also queue a manual addition. Temporary errors retry at bounded exponential intervals, at most five attempts per job, with two-minute leases and 30-second heartbeats. A lost insert/PATCH response is reconciled against the same event rather than creating another. Permanent failures and exhausted retries remain visible; the Talk booking stays valid. A manual request can retry a failure without changing booking data.

Events use `Talk — [Meeting Title]`, the actual booked start/end and host IANA timezone, `Talk Video Meeting` as location, host information and an optional agenda. Agenda URLs are omitted. The description includes only a non-secret `/device-test?room=...` Talk URL. It contains no booking bearer, verification code, LiveKit token, private qualifying answers or Google Meet conference data. Guests still need their private Talk invitation, email proof and host admission.

Rescheduling updates the same event ID despite a new Talk meeting association. Cancellation removes the mapped Google event. External Calendar edits are protected with etags/If-Match and produce reviewable conflicts. A host can deliberately reassert Talk details; recreating a deleted event uses a newly persisted stable ID. Unrelated Google events are never modified. Disconnect cancels queued work, clears local tokens/cursors and attempts revocation if OAuth is enabled; existing Google events are retained. Requests already in flight cannot be recalled.

## Reminders and invitations

Calendar popup reminders use `useDefault:false`, 15 minutes by default, with an optional 1440-minute popup. Preferences are editable under Bookings → Calendar Integration. Device/Calendar notification permissions determine visibility; Talk cannot force device alarms.

Talk's existing meeting-day and 15-minute email reminders retain their independent durable outbox and disabled SMTP setting. No email worker or retry policy was enabled for this task.

Google attendees require BOTH the operator invitation gate and the authenticated host's explicit invitation preference. Otherwise attendees are omitted and `sendUpdates=none` is used. The worker refuses to mutate an event that already has attendees while this authorization is off. With both gates authorized, supported `sendUpdates=all` handles invitations/changes, while stable event IDs prevent repeated creation. Available attendee response status is shown in booking details. Talk's private confirmation remains necessary for secure guest links; enabling Google invitations can add a distinct email and does not guarantee guest acceptance or Calendar appearance.

[Google event insertion and notification parameters](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert). Omitting attendees is an additional safeguard; `sendUpdates=none` alone is not treated as a universal no-email guarantee.

## Calendar-to-Talk behavior

Host-triggered “Check Calendar changes” performs an incremental read and stores the encrypted final-page sync token. Expired/invalid tokens (HTTP 410) cause a full resync; full reconciliation checks managed events missing from a listing. A separate, bounded 90-day read expands recurring events for overlap warnings. Checks record managed edits/cancellations and external busy conflicts without storing unrelated event titles or changing Talk bookings.

Conflicts require deliberate host acknowledgment or reassertion of Talk details in Calendar. No Calendar edit silently reschedules/cancels a Talk booking or blocks an availability slot. Talk remains authoritative. This is on-demand synchronization, not a webhook or continuous incoming watcher. Only the owned primary Calendar is supported. All-day dates without a returned timezone use the Talk host timezone, so a differently configured Google Calendar timezone requires manual review. Conflicts are warnings, not automatic availability enforcement.

Each read is paginated with a persisted lease and a 100-page safety bound. The cursor is committed only after successful reconciliation. [Google incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).

## APIs

All paths below begin `/api/auth/scheduling/google-calendar` and require a confirmed Talk account:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Sanitized connection/settings/status |
| POST | `/connect` | Session-bound OAuth URL; disabled until approved |
| GET | `/callback` | State/PKCE exchange and safe local redirect |
| POST | `/preferences` | Validated host reminder/auto-create/invitation settings |
| POST | `/disconnect` | Clear/revoke connection, cancel queued work |
| POST | `/check` | Read and reconcile authorized Calendar changes |
| GET | `/bookings/:id` | Host-owned sync/link/conflict/attendee state |
| POST | `/bookings/:id/add` | Queue idempotent manual sync |
| POST | `/bookings/:id/resolve` | Deliberate conflict acknowledgment/reassertion |
| GET | `/bookings/:id/ics` | Authorized ICS fallback download |

All writes reuse existing CSRF and origin validation, and all routes reuse durable request rate limiting. Cross-user booking access is rejected. External-provider details are reduced to fixed error codes.

## One fresh offline booking

- Created at **23 October 2026, 10:23:43 PM IST** using actual execution time.
- Synthetic Host / Synthetic Guest, `example.test` identities.
- **24 October 2026, 1:30–2:00 AM Asia/Kolkata**, 30 minutes; selected through the real availability engine, more than two hours after creation.
- Joining window: **1:15–3:00 AM IST**. Invitation expires one hour after meeting end.
- Database: `data/calendar-offline-test/fixture-g5WTe0/talk.sqlite`; exactly one booking in this fixture.
- ICS: `booking.ics`; mock event: `mock-calendar-event.json` in that isolated folder.
- Private signed invitation and dedicated offline signing/encryption keys stay in Git-ignored `private-invitation.json`; credentials are omitted from this report and console output.
- `artifacts/qa/calendar-fresh-fixture-results.json` records the sanitized creation result. Reopening verifies persistence, expiry/revocation binding and database/ICS/Calendar time equality.

The fixture is offline, with no listening server or SMTP transport. Its private localhost link is validated against this database only; the main app deliberately cannot resolve this synthetic booking. Using it publicly requires separate approval for an isolated runtime/origin. Port 3003, its allowlist/credentials/database and the existing tunnel were not changed.

## Verification

Final results are recorded below after the clean regression/build/browser run. Test processes use `tests/helpers/cloud-egress-guard.mjs`; all Google providers and SMTP transports are mocked. Test-only flags do not enable real application services.

| Check | Actual result |
| --- | --- |
| Focused Calendar unit/HTTP suite | **31 passed, 0 failed** |
| Final HTTP outage/error-sanitization recheck | **2 passed, 0 failed** (overlaps focused suite) |
| Fresh isolated fixture close/reopen, link/ICS/event consistency | **1 passed, 0 failed** |
| Disposable PostgreSQL 16 Calendar + scheduling suites | **2 passed, 0 failed**; container stopped afterward |
| Calendar browser checks | **Desktop 1440px and mobile 390px passed**, zero page errors; headings, preferences, sync status, ICS download and safe-link copying verified |
| Analytics no-scheduling-profile regression | **Passed**, zero page errors, using the fresh build |
| Relevant booking/auth/meeting/recording/whiteboard/Gemini-off regression run | **249 passed, 1 failed out of 250**; recording late-storage-ack fixture timed out |
| Standalone recording suite recheck | **24 passed, 1 failed out of 25**; a different loopback HTTP request failed; the earlier timeout case passed |
| Targeted rechecks of all affected recording cases | **3 passed, 0 failed** |
| Migration/persistence rechecks | **7 passed, 0 failed** |
| TypeScript | **PASS** |
| Production build (isolated output directory) | **PASS**; no main/public build replaced |
| Safety/configuration | **PASS**: four Calendar live gates off, scheduling SMTP default-disabled, both Gemini flags false, environment and fixture Git-ignored |

The broader regression suite is **not reported as fully green**. Existing recording fixtures showed intermittent deadline/loopback failures across runs; all affected cases passed targeted rechecks. Recording implementation/test behavior was not changed to hide those failures. Investigating this test instability is separate remaining work. An earlier hardcoded migration-count failure was corrected to validate all migration files. A source-encoding edit error was corrected by restoring the checkpoint's UTF-8 text before final checks. The first Analytics browser attempt used an older build; the fresh-build rerun passed.

Mock evidence does not prove live Google OAuth, delivery or device notification behavior. These test groups overlap; their counts must not be added and presented as unique tests.

Evidence: `artifacts/qa/calendar-*.log`, `calendar-browser-results.json`, `calendar-fresh-fixture-results.json`, `calendar-safety-results.json`, desktop/mobile screenshots. No credentials are required to read the sanitized reports.

## Local UI and manual verification

**http://localhost:3001/bookings#calendar-integration** (existing main UI; host login required). This is the Bookings integration panel, not the offline fixture's public runtime.

For safe local review: open Bookings, inspect setup/disconnected state, reminder options and each booking's “Calendar & joining link” details. Download ICS without connecting Google. Connection controls stay disabled until approved credentials/flags are configured. To replay only mocks: `npm run test:calendar`, `npm run test:calendar:browser`, and `npm run test:calendar:postgres` (last command uses a disposable local PostgreSQL container). Browser tests use `artifacts/qa/calendar-build`, configurable with `TALK_TEST_FRONTEND_BUILD`.

## Rollback and remaining live-test gates

Restore only the targeted source files from the checkpoint if needed; preserve all unrelated working-tree changes. Disable the four Calendar live flags first. Additive Calendar tables may safely remain; do not roll back by dropping existing scheduling, account or meeting tables. Existing Google events are retained on disconnect and require separate host-approved cleanup if ever created in a later live test.

Live Google OAuth, one real event, invitations, notification visibility and real Calendar acceptance have **not** been verified. Consent-screen verification/testing-mode policies and Google quotas apply to the eventual chosen project. Refresh-key rotation requires a controlled migration/reconnect. No push subscriptions, multiple calendars, automatic inbound booking edits or external availability blocking are implemented. Real email, OTP, public exposure and Calendar invitations each require their own explicit approval. Gemini remains disabled; no AI request, paid service, billing change or deployment occurred.
