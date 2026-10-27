# Phase 11 — Gmail delivery test preparation

Prepared on 22 October 2026. **No real SMTP connection, email send, Calendar API call, Gemini request, deployment, billing change or tunnel restart was performed.** The user selected `niknikhil.sharma22@gmail.com` as the single intended recipient, for preview only. Sending remains unauthorized.

## Offline readiness

| Requirement | Status / evidence |
| --- | --- |
| Gmail SMTP configuration | **READY for offline validation**: Gmail host, port 587, username, password and valid sender are configured |
| App Password | Present and matches the expected 16-letter format after removing display spaces; actual Gmail acceptance and account policy **UNVERIFIED** |
| Sender | `niknikhil.sharma22@gmail.com` |
| Configuration storage | `.env.local` exists and is Git-ignored; `.env` does not exist |
| STARTTLS | Required, TLS certificate checking enabled, minimum TLS 1.2; no SMTP connection was made |
| Stable signing secret | **NOT READY**: `SCHEDULING_EMAIL_LINK_SECRET` missing |
| Public scheduling URL | **NOT READY**: `SCHEDULING_PUBLIC_URL` missing; no external reachability probe was attempted |
| Normal scheduling delivery | Remains disabled |
| Gemini Cloud AI / operator approval | Both remain false |
| Overall real smoke test | **NOT READY**; provisional preview only, no send attempt consumed |

Keep existing SMTP credentials private and unchanged. Configure these backend-only entries in the existing Git-ignored `.env.local`, without adding `VITE_` prefixes:

```dotenv
SCHEDULING_EMAIL_ENABLED=false
SCHEDULING_EMAIL_LINK_SECRET=<stable-random-32-byte-base64url-secret>
SCHEDULING_PUBLIC_URL=https://<approved-scheduling-origin>
```

The signing secret must be 43 base64url characters generated from 32 cryptographically random bytes. Generate/save it locally without printing it or putting it in chat. Preserve it across restarts; rotation invalidates old emailed links. Do not replace the already configured SMTP username/password/sender or unrelated variables. No private environment file was modified during this task.

The public origin must actually serve the synthetic test booking with the appropriate signing configuration. Merely having a working HTTPS homepage does not prove an isolated test booking is accessible there. The existing restricted public WebRTC tunnel does not enable scheduling and was not changed. A new external route must be planned and approved separately; do not expose a development server to make this preview work.

## Existing system and fixes

The previous outbox, role-specific confirmation/reschedule/cancellation templates, ICS support, deterministic meeting-day and 15-minute schedules, credential revocation and restart recovery were reused. No recording, authentication, LiveKit or whiteboard system was rebuilt.

Template refinements add explicit meeting duration, Add to Calendar attachment instructions and dedicated reschedule/cancel links in both plaintext and HTML. Host actions lead to authenticated Bookings; invitee actions retain their scoped private confirmation credential. Cancellation messages contain no live join link. Opening an email action only selects a screen: all booking changes still require an authorized CSRF-protected POST and explicit user action. Host rescheduling now has a selection/confirmation panel, and an invitee can leave the rescheduling screen before choosing a slot. No unrelated page was redesigned.

The existing adapter now returns a sanitized `{accepted:true, smtpCode:<code-or-null>}` only after checking SMTP accepted/rejected recipients. SMTP acceptance is not inbox confirmation. Real transport logging remains disabled.

## Isolated one-message preparation

New files:

- `backend/src/scheduling/email-smoke-test.mjs`: isolated synthetic booking, redacted review, exact-message fingerprint, restart-safe reconstruction and durable single-attempt reservation.
- `scripts/prepare-scheduling-email-test.mjs`: **preparation-only** CLI; no send flag or SMTP dispatch path.
- `tests/scheduling-email-smoke.test.mjs`: mock-only safety tests.

Once required configuration is present, the authorized recipient can be prepared offline with:

```powershell
npm run scheduling:email:prepare -- --recipient niknikhil.sharma22@gmail.com
```

This command cannot send mail. It uses a fresh SQLite database under Git-ignored `artifacts/qa`, creates one fictional host/booking, cancels every normal outbox job in that database and starts no worker. It does not alter normal application records. The preparation refuses globally enabled scheduling delivery or Cloud AI, validates the existing named `SMTP_FROM` convention, and stops safely when configuration is missing.

A future separately authorized dispatcher must bind the approved recipient, exact message fingerprint and current configuration identity, explicitly verify the joining link, and durably reserve its single attempt before dispatch. Failures/crashes consume the attempt; there are no automatic retries or fallback recipients. The approval can survive process restart by reconstructing the same message from read-only synthetic records and nonsecret metadata, checking it against the original review and ledger. Private credentials are regenerated in memory; they are not saved in previews or job rows. SMTP diagnostics are not persisted. Inbox delivery always remains unverified until checked by the recipient.

No real recipient-specific executable request has been locked yet because the signing secret and public URL are missing. The actual preparation CLI was run offline with the approved recipient and correctly returned **NOT READY** before preparing/reserving a send. No normal scheduling worker was enabled.

## Proposed email preview — not ready for dispatch

| Field | Proposed value |
| --- | --- |
| Sender | `niknikhil.sharma22@gmail.com` using the configured Talk sender |
| Recipient | `niknikhil.sharma22@gmail.com` only |
| Subject | `Talk - Booking confirmed: Talk SMTP delivery test — fictional booking` |
| Meeting | Fictional booking with Talk Synthetic Test Host / Synthetic Test Invitee |
| Proposed date/time | Monday 26 October 2026, 15:00–15:30, Asia/Kolkata |
| Proposed count | Exactly **1 invitee confirmation**; no host message or reminders |
| Current sends / attempts | **0 / 0** |
| Joining link | `http://localhost:3001/booking-confirmation?id=PREVIEW_ONLY#[PRIVATE_BOOKING_CREDENTIAL]` |
| External reachability | **NO**: localhost placeholder; synthetic booking is not served at this URL |

The placeholder is deliberately not a usable credential or working invitation. It must be replaced by a securely generated, tested URL in a new exact review before sending can be approved. The date is also a proposal; if it changes, regenerate the review.

Complete provisional outputs (all joining credentials redacted):

- `artifacts/qa/phase11-gmail-provisional-preview.txt` — plaintext body.
- `artifacts/qa/phase11-gmail-provisional-preview.html` — HTML body.
- `artifacts/qa/phase11-gmail-provisional-preview.png` — locally rendered visual check.
- `artifacts/qa/phase11-gmail-provisional-review.json` — readiness and preview fields.

The email includes Talk branding, title, host/invitee context, explicit date/time/timezones, 30-minute duration, private join action, Add to Calendar instructions for `talk-booking.ics`, reschedule/cancel actions and verification/admission guidance. No real meeting content or participant list is included.

## Reminder and regression verification

| Check | Result |
| --- | --- |
| Broad backend regression | **278 passed, 0 failed, 0 skipped** |
| Scheduling/email subset | 45 passed, 0 failed; overlaps the broad run |
| Isolated smoke safety tests | 10 passed, 0 failed; overlaps the broad run |
| Browser form/session retry tests | **3 passed, 0 failed** |
| TypeScript/repository lint | Passed |
| Production frontend build | Passed; existing bundle-size/timing warnings remain |
| Scheduling browser workflow | Passed: email action selection without mutation, booking persistence, mock verification/admission, real local media, sharing/chat/reconnect/removal |
| Real Gmail authentication or delivery | **NOT RUN** |
| PostgreSQL execution | Still unverified; existing Docker blocker unchanged |

Backend/client total: **281 passed**. Subsets are not additive. Tests use simulated time, mock SMTP/MIME compilation, fake addresses and an external-egress guard. They cover immediate confirmations, recipient-local meeting-day reminders, 15-minute timing, obsolete job suppression, updated reschedule details, cancellation, leases, bounded retries, restart persistence, exactly one smoke invocation and explicit approval checks. SMTP at-least-once semantics still permit a duplicate after an uncertain acknowledgement/process loss in the ordinary reminder worker; the first smoke attempt itself never retries.

The first new browser action check found that the invitee's Keep current time button was hidden until a slot was selected. It was moved to the always-visible reschedule selection area; the final browser rerun passed. No GET request cancels or reschedules a booking.

Evidence: `artifacts/qa/phase11-gmail-regression.tap`, `phase11-gmail-scheduling.tap`, `phase11-gmail-client.tap`, `phase11-gmail-typescript.log`, `phase11-gmail-build.log`, `phase11-gmail-browser.log`, `phase11-gmail-preparation-status.log`. Source checkpoint: `artifacts/backups/phase11-gmail-preparation-1792688998612/`. No migrations were added in this preparation step.

## Google Calendar readiness

| Capability | Current implementation |
| --- | --- |
| Calendar OAuth / consent callback | Not implemented; Google Sign-In is separate and does not grant Calendar access |
| Calendar event creation through Google API | Not implemented |
| Talk link in events | Email includes private link; existing ICS intentionally does not include its bearer management credential. A future integration can use a secure meeting landing URL without exposing individual management credentials |
| Event reminders | Talk's own durable SMTP reminders implemented; Google event reminder settings not synchronized |
| Reschedule/cancel synchronization | Talk emails and updated/cancelled ICS supported; no Google API synchronization or webhook handling |
| Stored Calendar tokens | None; connection rows currently describe local ICS only |

A future host-owned calendar integration would require an approved OAuth web client ID/secret, consent configuration, registered callback, encrypted refresh-token storage and the least-privilege scope `https://www.googleapis.com/auth/calendar.events.owned`. Availability reads could additionally use `https://www.googleapis.com/auth/calendar.events.freebusy` if actually required. These scopes have not been requested. See [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) and [event reminder fields](https://developers.google.com/workspace/calendar/api/v3/reference/events/update).

Google App Passwords require 2-Step Verification and may be unavailable under account/Workspace security policies; this cannot be confirmed from local values. See [Google App Password guidance](https://support.google.com/accounts/answer/185833?hl=en). No credentials were tested against Google.

## Needed next

1. Save the stable signing secret securely in `.env.local` without sharing it.
2. Identify an approved HTTPS origin and safe serving arrangement for the isolated synthetic booking; current public tunnel restrictions remain in force.
3. Regenerate the exact one-message review and verify its real joining link, then obtain explicit recipient/message approval before any SMTP connection or email send.

Keep `SCHEDULING_EMAIL_ENABLED=false` throughout the isolated smoke test so the ordinary outbox cannot release unrelated notices. Do not enable the regular worker merely to send a single test. There is no requirement to re-enter the already present SMTP credentials unless a later authorized authentication test rejects them.

Local application URL: **http://localhost:3001/bookings**.
