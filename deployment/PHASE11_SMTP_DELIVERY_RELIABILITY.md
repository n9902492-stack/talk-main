# Phase 11 SMTP delivery reliability

**Latest status:** After separate approval, independent HTTPS access and preview verification passed, followed by exactly one explicitly authorized real confirmation attempt. Gmail returned final SMTP 250, the outcome is `CONFIRMED_ACCEPTED`, and the new guard is consumed; general delivery remains disabled. See `PHASE11_SMTP_RELIABILITY_REAL_SEND_RESULT.md` for the current result and manual-inbox confirmation requirement. Earlier preparation and the failed switch remain historical evidence. This report otherwise records the implementation results.

Prepared 24 October 2026. Local implementation, mock testing and read-only checks of the existing HTTPS endpoint. **No real email, OTP, real SMTP authentication, Calendar API call or new public exposure was performed.**

## Result

SMTP attempts now have persistent, sanitized phase diagnostics and explicit outcomes. Unknown acceptance is terminal and cannot automatically retry. Bookings has a host-only delivery status panel. The original ambiguous Gmail attempt remains consumed and unchanged.

One new synthetic booking, private invitation, calendar file, unique Message-ID and separate unconsumed guard are prepared in a fresh SQLite database. Public access for this new fixture is **BLOCKED**: the healthy existing tunnel serves the previous fixture. The prepared email is an **offline, non-sendable draft with a visible link placeholder**, not an approved final email containing an inaccessible URL.

## Original ambiguous attempt

The earlier record is still `failed_or_acceptance_unknown`, classified **UNKNOWN_AMBIGUOUS**, with `consumed=1` and one historical dispatch attempt. Its recorded SMTP authentication pass came from a separate preflight connection. There is no surviving evidence that the dispatch connection authenticated, completed DATA, or received Gmail's final acknowledgment. No exact timeout/connection-loss cause can be reconstructed from those missing diagnostics. The absence of an inbox search result does not prove SMTP rejection.

SHA-256 comparisons before and after this work verify these files are unchanged:

- `data/booking-link-test/confirmation-flow-vBfobG/confirmation-send-guard.sqlite`
- `artifacts/qa/confirmation-approved-send-result.json`
- `.env.local`
- `.env.tunnel-test.local`

The old guard was not reset, released, deleted or reserved again. The old send script was not executed. No additional real attempts occurred during this task. Evidence: `artifacts/qa/smtp-reliability-preservation-after.json`.

## Diagnostic architecture

Additive SQLite migration `017_smtp_delivery_attempts.sql` and PostgreSQL migration `015_smtp_delivery_attempts.sql` introduce `scheduling_email_attempts` and `scheduling_jobs.delivery_outcome`. Only disposable test databases and the new synthetic SQLite database were migrated during this task; the running main database was not opened by preparation scripts or manually migrated.

Each attempt records job ID, attempt number, stable Message-ID, start/completion timestamps, phase, safe SMTP code, fixed error category, retryability and a sanitized phase history. `(job_id, attempt_number)` is unique. A claimed attempt commits before SMTP starts. Diagnostic storage failure at that boundary prevents submission.

The transport's custom logger routes events through an AsyncLocalStorage observer, without printing or persisting raw SMTP text. It observes:

- Connection initiated/established and close/timeout.
- STARTTLS negotiation and post-TLS EHLO, where observable.
- AUTH started, succeeded or failed.
- Envelope submission, DATA command and local DATA stream completion where Nodemailer exposes it.
- Final message acceptance or rejection and an ambiguous terminal result.

Replies are matched to a FIFO command queue per connection, including SMTP PIPELINING. A MAIL/RCPT `250` is **not** final message acceptance. Local stream completion is **not** proof that Gmail received all bytes. A final message acknowledgment, or Nodemailer's completed result with the intended sole accepted recipient and a positive final response, is required for success.

No passwords, OAuth credentials, OTPs, email bodies, private booking URLs, recipient addresses, server free text or raw error stacks enter the diagnostic record. Sanitization uses fixed allowlists. History is bounded to 64 events; persistence callbacks and connection/command tracking are bounded. Each events column has a database length constraint. Host history returns at most 50 jobs and cannot cross host boundaries.

| Outcome | Meaning | Retry policy |
| --- | --- | --- |
| `CONFIRMED_ACCEPTED` | A final positive SMTP message acknowledgment was observed | Never resend; inbox delivery still requires confirmation |
| `CONFIRMED_REJECTED` | Explicit envelope/message rejection was observed | Terminal, no automatic retry |
| `CONFIRMED_NOT_SUBMITTED` | Complete observation proves failure before DATA | Existing bounded retry policy applies only to transient connection/DNS/timeout failures, maximum three attempts |
| `UNKNOWN_AMBIGUOUS` | Submission/acceptance cannot safely be ruled out | Terminal; never automatically retry |

Authentication and TLS configuration failures are not automatically retried. Arbitrary unclassified transport exceptions and resolved results without acceptance evidence become ambiguous, not successful.

An expired worker lease is never blindly reclaimed for sending. A durably recorded final acknowledgment can recover as accepted without resending; otherwise interrupted delivery becomes ambiguous or a previously established rejection. Legacy `sending` confirmation rows follow the same conservative recovery. Upgrading a queued legacy reminder cannot revive an uncertain legacy confirmation. Late diagnostics cannot overwrite a terminal attempt.

The normal authenticated `GET /api/auth/scheduling/email-deliveries` endpoint uses existing session authorization and scheduling rate limiting. The Bookings panel shows disabled delivery, SMTP acceptance/rejection/uncertainty, attempt count and safe response code. It offers refresh only, with no send/retry/enable controls. The existing restricted public runtime still blocks this endpoint; its route allowlist was not expanded.

## Fresh synthetic fixture

Preparation observed actual system time `2026-10-24T07:11:53.787Z` (12:41:53 PM IST), then selected an engine-verified available slot more than three hours ahead.

| Field | Value |
| --- | --- |
| Title | SMTP Reliability Test |
| Booking ID | `6ecc6490-aec8-4f19-8ffd-ffe7e5b82870` |
| Date | 24 October 2026 |
| Time | **3:45–4:15 PM Asia/Kolkata (IST)** |
| Duration | 30 minutes |
| Joining window | 3:30–5:15 PM IST |
| Link expiry | 5:15 PM IST, rejected afterward |
| Host | Talk Synthetic Reliability Host |
| Guest | Synthetic Reliability Guest |
| Sender and recipient | `niknikhil.sharma22@gmail.com` |
| SQLite database | `data/smtp-reliability-test/run-9MbE1g/talk.sqlite` |
| Message-ID | `<d25c45a7-dd32-4af6-85d4-6bd6f3d2472e@talk.local>` |
| New guard | `data/smtp-reliability-test/run-9MbE1g/send-attempt-guard.sqlite` |
| Guard state | `awaiting_public_verification`, consumed **0** |

This database contains exactly one synthetic account and one booking. No old booking was refreshed, duplicated, expired, modified or deleted. Host/reminder jobs are cancelled in the new database only. Exactly one invitee confirmation job is queued with zero attempts; **no worker or runtime serves this new database**. No SMTP adapter is constructed by the preparation script.

The private fixture directory is Git-ignored and has restricted Windows ACLs for the sandbox identity and local user only. The signing secret is reused backend-only from `.env.local` and is never written into the fixture or preview. Private invitation credentials are in `invitation.private.json`, not terminal output, reports or email drafts. Credentials are bound to booking and version; cancellation/version changes invalidate authorization. Offline checks reject cross-booking, tampered, cancelled and expired credentials and verify validity through meeting end plus one hour. The existing expiry policy already covers this window; no weakening or permanent media token was introduced.

The rerun pointer `artifacts/qa/smtp-reliability-fixture.private.json` prevents preparation from creating another booking. Running preparation again reuses this fixture. It does not refresh an expired booking; run the separate read-only verification to assess current validity.

## Public link readiness

Last verified existing origin: **https://bathroom-fully-rear-lucia.trycloudflare.com**.

- Main `http://localhost:3001/`: HTTP 200.
- Existing isolated loopback `127.0.0.1:3003`: HTTP 200 with the required forwarded Host/protocol headers; direct unapproved Host remains rejected.
- Existing HTTPS `/healthz`: HTTP 200, isolated mode ready. Email, guest OTP delivery, AI, SMS and recording false.
- Existing tunnel state identifies only the previous `confirmation-flow-vBfobG` database and its booking, and its isolated `SCHEDULING_PUBLIC_URL` matches that HTTPS origin.
- **The new fixture is not in the database served by that runtime.** Its confirmation page, signed-link HTTP verification and ICS download therefore cannot be marked publicly verified. No credential for this new fixture was placed in an inaccessible public email URL.

No existing runtime/tunnel was restarted, replaced or reconfigured. `.env.local` and `.env.tunnel-test.local` are unchanged. A new tunnel was not started.

**Separate approval is required** to bind an appropriately restricted isolated runtime to this new database/booking and the current verified origin. If that origin later expires, a replacement tunnel also requires separate approval. Then validate the actual confirmation page, private signed-link POST, invitation scope/expiry and ICS download over HTTPS, preserve the five-email allowlist, disabled services, secure cookies, CSRF, origin validation, guest verification and host admission. Re-render and re-review the final link-bearing message; bind its exact contents/attachment to the new guard. The current placeholder draft and guard are intentionally not eligible for dispatch.

## Email preview and calendar

Files in `data/smtp-reliability-test/run-9MbE1g/`:

- `confirmation.draft.html`: existing branded Talk HTML, disabled joining-link placeholder.
- `confirmation.draft.txt`: readable plain text below.
- `talk-booking.ics`: calendar attachment.
- `review.json`: nonsecret preparation summary.
- `fixture.private.json`, `invitation.private.json`: protected local fixture data, never publicly served.

Subject: **Talk - Booking confirmed: SMTP Reliability Test**

```text
Hi Synthetic Reliability Guest,

Your meeting with Talk Synthetic Reliability Host is confirmed.

Meeting: SMTP Reliability Test
Duration: 30 minutes
Invitee time: Saturday, October 24, 2026 at 3:45 PM -
              Saturday, October 24, 2026 at 4:15 PM (Asia/Kolkata)
Host time: the same Asia/Kolkata time
Host: Talk Synthetic Reliability Host

View booking and join: [SECURE_TALK_JOIN_LINK_PENDING_PUBLIC_APPROVAL]

Add to calendar: Open the attached talk-booking.ics file in your calendar app
to add or update this meeting.

Rescheduling and cancellation are unavailable in this isolated test.
Contact the host if you need changes.

Keep this private booking link to yourself. Talk will verify your email
before guest access; the host may need to admit you from the waiting room.

Talk
```

ICS uses `DTSTART:20261024T101500Z` and `DTEND:20261024T104500Z`, exactly 3:45–4:15 PM IST. It is a local `METHOD:PUBLISH` attachment, with the new booking's UID and no bearer credential. No external calendar invitation/API write occurs.

The new guard fingerprints this exact offline draft, attachment, recipient and Message-ID. Its `awaiting_public_verification` state cannot be reserved by the existing one-shot helper, which requires `awaiting_approval`. The original guard remains separately consumed.

## Verification

All automated tests use mocked transports or loopback-only SMTP servers, with the cloud-egress guard. No real SMTP authentication or delivery occurred. **217 distinct automated tests passed, 0 failed** (216 main regression tests plus one PostgreSQL integration test), plus a standalone browser verification at two viewport sizes.

- Main regression suite: **216 passed, 0 failed, 0 skipped**, completed in 195.6 seconds.
- Focused SMTP/outbox/guard suite: **46 passed, 0 failed** (overlaps main suite; do not add to total).
- Additional final edge cases: **18 passed, 0 failed**, including queued legacy reminders not reviving uncertain confirmations (overlaps main suite; do not add to total).
- Disposable PostgreSQL 16 scheduling test: **1 passed, 0 failed**; includes new migration, diagnostic rows, mock acceptance, deduplication, guest admission and reopen persistence. Initial sandbox run could not access Docker; execution succeeded with the required local Docker access. The disposable container was stopped; unrelated containers were untouched.
- Real browser UI with mock backend: **PASS** at desktop 1440px and mobile 390px; unknown-outcome warning, disabled delivery, refresh, no send controls, no horizontal overflow or browser errors.
- TypeScript: **PASS**, `npm run lint` (`tsc --noEmit`).
- Production build: **PASS**, Vite built in 25.37 seconds to `artifacts/qa/smtp-reliability-build`; routine bundler timing warnings only. It was not deployed or substituted into an active service.
- Offline fixture/ICS/invitation/allowlist/guard checks: **PASS**.
- Preservation hash checks: **PASS**.
- Targeted whitespace check for affected tracked files: **PASS**. A whole-checkout `git diff --check` reports an existing extra blank line at EOF in unrelated `frontend/src/lib/workspacePreview.ts:29`; it was left unchanged.

Regression coverage includes AUTH failure, TLS failure, greeting/connection timeout, drop before DATA, envelope rejection, final rejection, drop during DATA, lost final acknowledgment, observed acceptance followed by application error, PIPELINING, duplicate/concurrent execution, crashed worker recovery, SQLite reopen, bounded private-data-free diagnostics, host isolation, event/booking creation, availability, invitation expiry/tampering, templates, ICS, scheduling client/calendar helpers, guest authorization/admission, email/password, Google Sign-In/confirmation, Firebase Phone verification, meeting permissions and Google Calendar mock services.

Evidence:

- `artifacts/qa/smtp-reliability-regression-final.tap`
- `artifacts/qa/smtp-reliability-final-focused.tap`
- `artifacts/qa/smtp-reliability-edge-final.tap`
- `artifacts/qa/smtp-reliability-postgres.log`
- `artifacts/qa/smtp-delivery-browser.json` and desktop/mobile PNGs
- `artifacts/qa/smtp-reliability-typescript.log`, `smtp-reliability-build.log`
- `artifacts/qa/smtp-reliability-health.json`
- `artifacts/qa/smtp-reliability-preservation-before.json`, `smtp-reliability-preservation-after.json`

## Exact files changed for this task

New backend files:

- `backend/src/migrations/017_smtp_delivery_attempts.sql`
- `backend/src/postgres-migrations/015_smtp_delivery_attempts.sql`
- `backend/src/scheduling/delivery-diagnostics.mjs`
- `backend/src/scheduling/delivery-attempts.mjs`

Modified backend/frontend files:

- `backend/src/scheduling/transport.mjs`
- `backend/src/scheduling/jobs.mjs`
- `backend/src/scheduling/routes.mjs`
- `frontend/src/pages/Scheduling.tsx`
- New `frontend/src/components/EmailDeliveryStatus.tsx`

New preparation/verification scripts:

- `scripts/check-smtp-reliability-readiness.mjs`
- `scripts/prepare-smtp-reliability-fixture.mjs`
- `scripts/verify-smtp-reliability-preservation.mjs`

Tests:

- New `tests/smtp-delivery-reliability.test.mjs`
- New `tests/smtp-delivery-browser.mjs`
- Modified `tests/confirmation-smtp-diagnostics.test.mjs`
- Modified `tests/scheduling-email-transport.test.mjs`
- Modified `tests/scheduling-email-jobs.test.mjs`
- Modified `tests/scheduling-server.test.mjs`
- Modified `tests/helpers/scheduling.mjs`
- Modified `tests/production-scheduling.test.mjs`

Report: `deployment/PHASE11_SMTP_DELIVERY_RELIABILITY.md`. Generated test evidence and the fresh private fixture are listed above. Source checkpoint: `artifacts/backups/smtp-reliability-20261024-122502/`. The checkout already contained extensive earlier uncommitted work; none was reset or cleaned.

## Remaining blockers and next controlled test

**One controlled live Gmail test is not ready to send yet.** Offline Gmail configuration validates, including sender/recipient match and five-email allowlist membership. This task deliberately did not authenticate with Gmail or verify delivery; previous historical authentication/delivery is not a fresh readiness guarantee.

Required next steps, each within separate explicit approval where external action is involved:

1. Approve only the isolated runtime's new fixture/route binding, preserving or rechecking the current origin. Do not enable SMTP to perform these public-link checks.
2. Verify the exact HTTPS booking link and ICS; prepare the final branded message and bind its new fingerprint to the unconsumed guard. The placeholder draft must never be sent.
3. Obtain approval for exactly one invitee confirmation attempt, no host/reminder/OTP/Calendar sends or retries. Use persistent diagnostics on that attempt and keep its guard consumed even if the result is ambiguous. Do not reuse the old hardcoded consumed-booking send script.
4. Check future meeting and joining-window validity immediately before any separately authorized attempt. If it has passed, stop; do not silently refresh or repurpose this booking.

General SMTP, SMS, Gemini, recording/transcription and Calendar writes remain disabled in the isolated runtime. Main feature configuration, LiveKit credentials and the public tunnel were not changed. Existing main application URL remains **http://localhost:3001/**; the new build was verified in disposable loopback browser fixtures that have been closed. Loading new backend code into a long-running development service requires a normal, separately coordinated restart when no meeting would be interrupted.
