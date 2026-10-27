# Phase 11 Intelligent Meeting Concierge

## Status: historical architecture review; scheduling rebuild now implemented locally

The user subsequently authorized a new backend in this checkout. See [the rebuild report](PHASE11_SCHEDULING_BACKEND_REBUILD.md) for the implementation, actual validation results, remaining release gates and rollback instructions. The original audit below is retained as historical evidence.

Reviewed on 2026-10-22 in `C:\Users\ss828\Downloads\talk-main`, branch `main`.

**11Q-1 is complete. 11Q-2 through 11Q-10 are not implemented or verified.**

The supplied request assumes an existing Calendly-style Phase 11 scheduler and explicitly says not to rebuild it. This checkout contains a browser-only booking demonstration, not that backend. Proceeding directly would create a new scheduling system rather than extend an existing one. The next prerequisite is the location/branch of that system, or explicit confirmation to build the missing foundation here. No application behavior has been changed for this review.

## Findings and evidence

| Area | Observed implementation | Consequence |
| --- | --- | --- |
| Booking page | `frontend/src/pages/Booking.tsx`: five fixed October 2026 dates, five fixed times, fixed Asia/Kolkata timezone | These are demo choices, not computed availability. |
| Booking persistence | The submit handler writes `talk-booking` to browser `sessionStorage` | No server booking is created, no conflict prevention or future room association exists. |
| Confirmation | Page explicitly describes a local preview and says no invitation email is sent | This must not be represented as a confirmed backend appointment. |
| Calendar download | Client-generated ICS for the local demo | Not a reminder queue or durable invitation. |
| Dashboard | `readSavedDemo()` in `frontend/src/lib/workspacePreview.ts`, consumed by Dashboard | Existing dashboard booking preview depends on the demo storage format. Preserve it during incremental integration. |
| Routing | `/bookings` maps directly to the demo component in `frontend/src/AppRouter.tsx` | No host scheduling editor, public booking profile, embed or booking-management routes were found. |
| Backend | Inspected auth routes and searched `backend`, `scripts`, `tests` for booking/calendar/availability/appointment/reminder implementations | No scheduling service or booking API found. Existing transcription retry scheduling is unrelated. |
| SQLite migrations | `001_auth.sql` through `012_whiteboard_cloud.sql` | No scheduling migration. |
| PostgreSQL migrations | `001_auth.sql` through `010_whiteboard_cloud.sql` | No scheduling migration. |
| Main database | Opened `data/talk.sqlite` using Node SQLite with `readOnly: true`; inspected schema table names only | No booking, availability, appointment, reminder or invitation tables. No customer records read or changed. |
| Other local branch | Searched tracked paths in `backup/pre-github-lfs-20261015` for scheduling-related filenames | No candidate scheduler found there; this is a filename inventory, not a claim about remote branches or other projects. |
| Existing browser check | `tests/browser-smoke.mjs` tests local demo confirmation and ICS download | It does not establish durable booking functionality. |

No remote repository was fetched. Other folders, remote branches and an external PostgreSQL schema were not inspected. If the existing scheduler is there, its implementation and migration history must be reviewed before adopting the proposals below.

## Reusable architecture

- `backend/src/auth.mjs`: authenticated sessions, origin checks, JSON limits, CSRF validation, rate limits and route mounting. Keep Google/email/phone authentication unchanged.
- `backend/src/async-database.mjs`: request-scoped async SQL, SQLite transaction serialization and PostgreSQL transaction-scoped advisory identity locks. Use these rather than a process-only booking mutex.
- `backend/src/database.mjs` and `postgres-database.mjs`: versioned transactional migrations. Production PostgreSQL migration is explicit; do not apply migrations during this review.
- `backend/src/meeting-management.mjs`: meeting ownership, members, pending admission, moderator decisions, revocable connection tickets, meeting audit events and room isolation.
- `backend/src/meeting-gateway.mjs`: same-origin WebSocket validation, server-side SFU token issuance, revalidation and revocation. Clients receive opaque Talk tickets rather than unrestricted SFU JWTs.
- `frontend/src/pages/DeviceTest.tsx`, `lib/meetingSession.ts` and live meeting components: real device checks, staged media ownership and current authenticated meeting join flow.
- Existing recording, transcript, whiteboard and AI services: authoritative resource access checks and consent rules. Reuse authorization when exposing follow-up links; a booking must not grant these privileges.
- Existing recording and AI durable jobs: patterns for leasing, bounded retries, recovery and audit. Reminder delivery needs its own outbox and deduplication; it must not reuse AI processing jobs.
- Existing local browser helpers and cloud-egress guard: isolated SQLite fixtures, mock account provider, real local SFU and blocked external traffic for integration tests.

### Critical guest compatibility gap

Current `meetingSession()` requires a verified permanent account. Meeting members and connections reference `accounts`; connection authorization additionally checks the normal `sessions` table. Anonymous booking guests cannot simply use those endpoints. Changing `meetingSession()` to accept any booking token would risk opening recordings, AI reports, whiteboards and administration routes.

Proposed solution: an explicitly scoped guest principal with dedicated guest endpoints and a shared internal admission policy. Existing permanent-account routes keep their current authorization. Extend internal member/ticket handling to recognize revocable meeting-scoped guests, without creating ordinary permanent accounts or globally weakening session checks. Test every resource boundary before enabling guest joins. Exact migration shape depends on the missing scheduler's existing invitee model.

Meeting creation currently writes meeting/member records without explicitly creating a LiveKit room. That is useful for future associations, but `talk_meetings.status` currently permits only `active` and `ended`; there is no scheduled join-window enforcement. A future association alone must not make a room joinable months early.

## Proposed service boundaries (not implemented)

1. Scheduling configuration and deterministic draft parsing.
2. Pure availability and recommendation engine with injected clock.
3. Transactional booking, cancellation and rescheduling service.
4. Meeting association and narrowly scoped guest invitation/session service.
5. Qualification validation and retention service.
6. Durable reminders/outbox with local mock delivery in tests.
7. Follow-up resource resolver delegating to existing authorization.
8. Embed policy and safe configuration service.
9. Private first-party analytics aggregation, optional consented page events.

All capabilities start disabled in the temporary tunnel runtime. Do not change its route allowlist, dedicated database, environment file, frontend build, process or tunnel. Do not start a new publicly accessible listener.

## Proposed additive schema (not migrations created)

Reconcile these entities with the existing scheduler first. Do not create parallel tables if equivalents already exist.

| Entity | Purpose and important constraints |
| --- | --- |
| Host schedule/settings | Host account FK, IANA zone, weekly wall-clock windows, notice, horizon, buffers, daily count/minute caps, long-meeting break rules, focus periods, version |
| Event types | Unpredictable public ID, host FK, title, validated duration/capacity, enabled flag, host-preference ranking, qualification schema, suggested follow-up duration |
| Bookings | Host/event FK, UTC start/end, guest timezone snapshot, confirmed/cancelled/completed state, unique meeting association, revision, idempotency key/request hash and minimal invitee details |
| Invitations | Booking/meeting binding, recipient binding, hash of random secret, expiry, redeemed/revoked timestamps and version; never plaintext secrets |
| Guest sessions/connections | Explicit meeting and invitation binding, expiry, revocation and opaque ticket hashes; separate from normal account sessions |
| Qualification responses | Booking FK, schema snapshot/version, validated answers, retention deadline and deletion metadata |
| Reminder outbox | Unique booking/version/channel/reminder key, due time, status, attempts, lease expiry, provider deduplication reference and sanitized failure classification |
| Scheduling audit | Actor/principal class, booking/config reference, action and time; omit answers, invitation secrets and full contact details |
| Analytics | Minimal consented event counters and booking-derived aggregates; no cross-site identifiers or third-party transmission |

Use both existing SQLite and PostgreSQL migration runners, constraints, indexes and foreign keys. Preserve existing rows. Guest-related changes need explicit compatibility coverage across all member/connection queries, not just insertion tests. Index host/time/status, public event lookup, invitation hash, reminder due/lease and booking idempotency. Do not put contact details in public IDs or URLs.

## Proposed backend API surface (not added)

| Scope | Proposed endpoints | Authorization |
| --- | --- | --- |
| Host | `/api/auth/scheduling/event-types`, `/settings`, `/parse`, `/bookings`, `/analytics` | Existing verified host session, CSRF for writes, owner scoping |
| Host diagnostics | Event availability explanations and qualification responses | Owning host only; no private appointment details in public availability |
| Public booking | `/api/scheduling/events/:publicId`, `/slots`, `/book` | Minimal public projections, bounded query horizon, rate limits, booking-form challenge/CSRF and idempotency |
| Booking management | Booking detail, cancel, reschedule, follow-up | Explicit booking-scoped verified credential or owning host; no enumerable detail access |
| Guest admission | Invitation redemption, guest session, waiting state, join ticket, leave | One meeting, expiry/join-window checks, required host admission, revocation and origin/CSRF validation |
| Embed | Validated event config, embed code and dedicated booking frame route | Host chooses allowed parent origins; public projection only |

Actual route names must follow the recovered scheduler's conventions. Do not mount new public guest endpoints underneath the broad existing authenticated resource handlers.

## Booking integrity and availability

- Store instants as UTC and preserve the selected IANA zones. Validate all zone identifiers using the runtime timezone database. Detect the guest browser zone initially but always show a manual override.
- Generate actual UTC candidate instants and project them into the host's weekly local windows. This avoids silently constructing nonexistent spring-forward times. Distinguish repeated fall-back wall times using UTC offsets. Test half-hour transitions and slots crossing midnight, not just US DST.
- Bound horizon, slot count and request size. Apply event duration, host working hours, focus periods, minimum notice, existing confirmed bookings and their pre/post buffers, long-meeting breaks, daily meeting and total-minute caps.
- Apply host constraints across all their event types. Define daily caps using the host zone; account for intervals crossing day boundaries. Capacity needs an explicit policy: attendees in a shared group occurrence versus distinct overlapping bookings. Do not infer a policy from a free-text number.
- Rank only eligible slots: earliest, morning, afternoon and a configured host preference. Deduplicate recommendations and retain a View all option. Never fabricate popularity.
- Booking confirmation acquires one host scheduling lock inside a transaction, recomputes availability from current committed rows and writes the booking, meeting association, invitation metadata, reminder and audit atomically. PostgreSQL uses the existing transaction-scoped identity lock; SQLite uses `BEGIN IMMEDIATE`.
- Return the same result for the same idempotency key and normalized request hash; reject key reuse with another payload. Make the unique constraint authoritative.
- Cancel/reschedule under the same host lock and booking revision check. Revoke stale invitation/session/tickets and replace stale reminders. Roll back all changes if the new slot is unavailable. Never destroy the old booking before securing its replacement.
- Do not perform email delivery or LiveKit network calls inside a booking transaction. Future room association is database-only. Recheck join window, admission and revocation when granting media access.

## Guest security and privacy

- Use high-entropy credentials, store hashes, expiry and revocation. A bearer link alone cannot prevent deliberate sharing: use recipient verification before redemption and a short-lived cookie-bound session to reduce forwarding risk. Do not claim unshareability.
- Redeem secrets once, transactionally; support reconnect through the bound session, not replaying the invitation. Separate authenticated host access from guest identity. Expired/revoked/cancelled invitations fail closed.
- Avoid secrets in URL query strings and referrers; use a fragment-to-POST exchange, remove the fragment promptly and apply `no-referrer`, `no-store` and sanitized logging. Test browser history, redirects and analytics for leakage.
- A booking guest may see only the branded public preview and their own booking, request admission and use authorized live capabilities after admission. No dashboard, profile administration, host reports, saved recordings, transcripts, qualification responses of others or private whiteboard exports.
- Reuse host/cohost moderation, room isolation, removal and reconnection policies. Guest-to-host promotion is denied. Recording/AI consent remains explicit and separate; joining a booked meeting is not recording consent.
- Qualification answers have bounded lengths, validated choice IDs, required fields, schema snapshots and retention controls. CRM adapter remains disabled, with no automatic contact creation or external transmission.

## Deterministic parser and future AI boundary

Proposed supported grammar: explicit durations, weekday/day lists, AM/PM or 24-hour ranges, buffers, minimum notice, capacity and daily limits. Return parsed fields plus unsupported fragments, missing fields and ambiguities. Display an editable draft and require explicit confirmation before writing anything.

Examples that require clarification include an unqualified `2 to 5`, conflicting durations, overnight ranges without explicit intent and ambiguous capacity. Unsupported expressions must not silently become defaults. Label this a deterministic parser, not AI. A future assistance adapter is inert by default and cannot invoke Phase 9, Gemini or the Phase 10I one-attempt test.

## Embed and follow-up design

- Dedicated iframe booking route; keep authenticated pages non-embeddable. Apply route-specific CSP `frame-ancestors` from exact validated host-approved origins rather than weakening site-wide protections.
- Validate every parent/event/branding parameter server-side. Prefer explicit allowed color/theme enums; no arbitrary HTML, CSS or redirect URLs.
- Validate both `event.origin` and `event.source` and a bounded message schema. Send only necessary resize/status messages to an exact target origin. Never post answers, emails, join secrets, resource URLs or booking contents to the parent.
- Third-party cookies may be blocked. Design a short-lived booking-form challenge that does not require changing normal auth cookies to `SameSite=None`; complete sensitive invitation redemption top-level. Verify restrictive browser settings and keyboard focus in iframe tests.
- Follow-up displays actual completion, links to real availability and an explicitly configured next duration. Resource links are resolved through existing recording/transcript/whiteboard authorization and retention checks. Only an existing approved and authorized summary may be offered; never generate one automatically.

## Frontend integration proposal

Preserve the landing page, existing demo and dashboard preview until a real scheduler is available. Add scoped host configuration and public booking components using current Talk typography, light surfaces, accent tokens and rounded controls. Reuse real prejoin device checks and admission UI once scoped guest access exists.

Public flow: choose event type, inspect a few recommended slots or all slots, edit timezone, enter required details, confirm, then show durable booking and join-window status. Provide loading/empty/error/cancelled/expired states, keyboard focus management, reduced motion and mobile layout. Never display confirmation before transaction success.

## Ordered milestones and acceptance gates

| Milestone | Work | Required validation before proceeding |
| --- | --- | --- |
| 11Q-1 | Review current implementation and recovery/integration plan | Complete: demo-only baseline established; missing scheduler prerequisite identified |
| Foundation prerequisite | Recover existing Phase 11 scheduler, or authorize a new one | Review its actual APIs/schema/jobs and tests; adjust this plan without duplicating records |
| 11Q-2 | Atomic future room association and scoped guest admission | No SFU room creation at booking; expiry/replay/revocation, waiting/host removal, cross-room and private-resource denial, normal account flow unchanged |
| 11Q-3 | Deterministic draft parser and host confirmation | Example parsing, ambiguity/unsupported clauses, bounds and zero AI calls |
| 11Q-4 | Real slots, ranking, zone detection/override | DST gap/fold, offsets, host/guest zones, explicit confirmation/email zone labels, no invented rankings |
| 11Q-5 | Protect My Time | Gaps/focus/notice/caps and simultaneous confirmations/reschedules across SQLite and PostgreSQL |
| 11Q-6 | Qualification questions and retention | All question types, schema changes, malicious/oversized inputs, owner-only answers and retention deletion |
| 11Q-7 | Completion and follow-up | Cancelled/ended/retained states, real follow-up slots, unauthorized resources denied, no AI generation |
| 11Q-8 | Safe iframe and embed generator | Allowed/denied frame origins, CSP, spoofed messages, cookie restrictions, mobile/keyboard and no parent data leaks |
| 11Q-9 | Private analytics and UI polish | Real booking-derived metrics, page-event consent/opt-out, no external analytics, empty/loading/error states |
| 11Q-10 | Full validation | SQLite/Postgres, browser, meetings/whiteboards/recording/auth/AI foundation regressions, TypeScript and isolated production build |

Reminder testing must cover lease expiry, restart recovery, cancellation/reschedule races and transport deduplication. Do not claim exactly-once email delivery if the mail transport cannot deduplicate uncertain acknowledgements.

Use isolated fixture databases and local/mock delivery, with the existing external-egress guard. Guest/media browser tests use synthetic camera/microphone and local SFU, never the public test environment. Physical-device/remote-network validation remains a separate explicitly reported manual activity.

## Checks actually performed in this review

- Read-only source, routes, migration inventories and main SQLite schema inspection: complete.
- `.env.local` cloud-AI enabled and operator-approved values checked in memory: both `false`. No credential displayed or copied.
- `GET http://127.0.0.1:3001/bookings`: HTTP 200. This establishes reachability only, not booking persistence.
- No source code, migrations, API routes or user-facing features implemented in this milestone.
- No application tests, PostgreSQL execution, new browser flows, TypeScript or build run for an unimplemented feature. Previous phase results are not reported as Phase 11 validation.
- No external AI request, Gemini test invocation, email/SMS send, deployment, paid resource, database migration, service restart or tunnel change performed.

## Local preview and manual inspection

Existing demo: `http://localhost:3001/bookings` (also `http://127.0.0.1:3001/bookings`). It remains the original local browser preview, not the proposed concierge.

To verify the current baseline manually: open the demo, choose a listed time, enter fictional details and observe that confirmation says it is saved in this browser with no invitation email. Do not invite real customers using these fixed demo slots. Actual concierge manual acceptance instructions will be added as milestones are implemented.

## Next prerequisite

Supply the folder or branch containing the existing Phase 11 scheduling implementation, or confirm that a new scheduling foundation should be built in this checkout. Until then, continuing past 11Q-1 would conflict with the instruction to extend rather than rebuild the existing scheduler.
