# Phase 11 — normal booking confirmation flow preparation

Verified locally on 24 October 2026. **No real email, OTP, Calendar write or new public exposure was authorized or performed. This is not ready for an external send.**

## Environment and audit

- Direct HTTP request to `http://127.0.0.1:3001/` returned **200**. The main application was not restarted or changed. The initial Windows port inventory did not expose its listener; direct HTTP is the authoritative check.
- `http://127.0.0.1:3003/healthz` failed with **ECONNREFUSED**.
- The origin recorded in `data/booking-link-test/public-tunnel.json` failed DNS with **ENOTFOUND**. Its persisted `running/connected` flags are stale and are not proof of a healthy tunnel. That record was preserved, not reused for the email.
- Reviewed the scheduling rebuild, invitation/reminder, future-booking, HTTPS and Google Calendar reports, plus the actual scheduling routes/service, React pages, signing, SMTP adapter, templates, jobs, guest proof and ICS code.
- The normal booking transaction already queues host/invitee confirmations and reminders. The existing worker uses persisted leases and bounded retries. This task did not activate that worker's SMTP transport or replace the existing booking/email system.

## One fresh synthetic booking

| Detail | Result |
| --- | --- |
| Title | Talk Booking Confirmation Test |
| Host | Synthetic Talk Host |
| Guest | Synthetic Test Invitee |
| Appointment | **24 October 2026, 2:15–2:45 PM Asia/Kolkata (IST)** |
| Duration | 30 minutes |
| Joining window | **2:00–3:45 PM IST** |
| Invitation expiry | **3:45 PM IST** |
| Database | `data/booking-link-test/confirmation-flow-vBfobG/talk.sqlite` |
| Records | Exactly one booking and one synthetic account |
| Booking creation | Actual React host Bookings page → normal availability/event APIs → public booking page → available future slot → details → Confirm booking → normal scheduling booking API |

The available slot was more than two hours ahead of actual execution time. It was not booked by an old hardcoded email sender. The first successful creation was retained through subsequent checks; reruns resumed it instead of creating duplicates. The booking, associated scheduled meeting, invitation and queued job survived database close/reopen. No live media room was created.

The normal transaction produced its standard email jobs. In this new fixture only, host confirmation and reminder jobs were cancelled, leaving **one `confirmation:invitee` queued with zero attempts**. The runtime transport is null and its periodic worker timer was stopped. No automatic SMTP sending/retries can run in this stopped local fixture. Existing workers and historical attempt guards were not modified or reset.

## Exactly one email draft

Sender and recipient: **niknikhil.sharma22@gmail.com**

Subject: **Talk - Booking confirmed: Talk Booking Confirmation Test**

```text
Hi Synthetic Test Invitee,

Your meeting with Synthetic Talk Host is confirmed.

Meeting: Talk Booking Confirmation Test
Duration: 30 minutes
Invitee time: Saturday, October 24, 2026 at 2:15 PM – 2:45 PM (Asia/Kolkata)
Host time: Saturday, October 24, 2026 at 2:15 PM – 2:45 PM (Asia/Kolkata)
Host: Synthetic Talk Host

View booking and join: [SECURE HTTPS LINK PENDING APPROVED PUBLIC ORIGIN]

Add to calendar: Open the attached talk-booking.ics file in your calendar app.

Rescheduling and cancellation are unavailable in this isolated test.
Contact the host if you need changes.

Keep this private booking link to yourself. Talk will verify your email
before guest access; the host may need to admit you from the waiting room.

Talk
```

The existing branded HTML/plaintext template and SMTP adapter were reused. The exact email was compiled once per offline verification run using Nodemailer's local stream compiler injected into that adapter: **zero external SMTP connections**. Sender, recipient, absence of CC/BCC, attachment, TLS configuration and no debug logging were checked. This is mock compilation, not delivery or Gmail authentication.

Complete draft HTML, plaintext, MIME, JSON, browser credential and ICS are in the fixture directory, which has Windows ACL inheritance disabled and access restricted to the current user. The directory and `.env.local` are Git-ignored. No signing secret or SMTP password was written into the draft or reports.

The draft deliberately uses a reserved, unusable HTTPS placeholder, never the stale tunnel or localhost. It is flagged `sendAuthorized:false` and `externalUseBlocked:true`. It **must be regenerated and reviewed** after an approved public origin is running. It is not input for the previous booking's consumed one-shot send authorization.

## Joining, SMTP and Calendar readiness

- The current backend-only signing secret generates valid booking/version-bound access. HTTP detail authorization succeeds with the derived credential while SMTP is disabled. Tampered, expired, cancelled, version-changed and cross-booking signatures are rejected.
- Signing validity lasts through the appointment and one hour after its end. Guest email verification and host admission remain mandatory; incorrect proof cannot be redeemed. OTP delivery is disabled and any live OTP requires separate authorization.
- The existing five-email allowlist is unchanged; the selected recipient is included.
- Gmail configuration passes offline validation; configured sender and SMTP account match the requested address. **Current live SMTP authentication was not tested**, and no delivery success is claimed.
- ICS was downloaded from the actual confirmation UI and checked against the exact stored start/end. It contains no bearer credential or localhost link. UTC event times are 08:45–09:15 on 24 October 2026.
- Google Calendar configuration/OAuth/read/write/invitation gates are disabled/unconfigured; read-only main-database inspection found no Calendar connections. The fixture has no connected Calendar account. No real Google event creation was tested or claimed.
- Main environment files, existing public-test database and tunnel state file remained byte-identical during the final verification. The main database was opened only read-only for connection status. Its active application can checkpoint WAL/change transient records independently, so database-file hashes were not used as proof of application data mutation. All test writes target the distinct new fixture database.

## Tests and evidence

- Scheduling, booking persistence/concurrency, guest authorization, links, templates, outbox jobs, restart/retry/duplicate safeguards, served-preview safeguards and frontend request behavior: **61 passed, 0 failed**.
- Calendar and calendar UI utilities plus frontend request checks: **37 passed, 0 failed**; three frontend request tests overlap the previous run.
- **Unique automated total: 95 passed, 0 failed.**
- Additional actual React browser preparation workflow: **passed**, zero page errors. Covers host availability/event creation, future public booking, persisted confirmation/job, signed confirmation page, email-disabled guest flow and actual ICS download.
- TypeScript check: **passed**.
- Production build: **passed**, existing bundle/timing warnings only.
- An initial test command omitted the TypeScript loader; its test-file loading failure was corrected with `--import tsx`. Initial browser assertions were adjusted to use browser-localized date labels and wait for fragment removal. Neither required a production fix or another booking.

Evidence: `artifacts/qa/booking-confirmation-regression-final.tap`, `booking-confirmation-client-calendar.tap`, `booking-confirmation-flow-results.json`, `booking-confirmation-typescript.log`, `booking-confirmation-build.log`, `booking-confirmation-host.png`, `booking-confirmation-guest.png`.

Only the test harness gained optional explicit signing links so guest link authorization can be tested without an SMTP adapter. The local preparation script is `artifacts/qa/prepare-booking-confirmation-flow.mjs`. No production authentication, LiveKit, recording, whiteboard, analytics, Calendar or SMTP implementation was changed.

## Approval required next

1. Approve launching an isolated runtime for this new synthetic fixture and a new temporary Cloudflare Quick Tunnel. Step 4 of the user's request explicitly requires approval before starting/changing a public tunnel.
2. Keep the allowlist/security controls and all outbound delivery disabled. Verify the newly assigned origin, fixture route scope and signed guest links before preparing the external email again.
3. Refresh the booking if it is no longer at least two hours ahead. Never silently reuse an expired appointment.
4. Bind the exact final message/ICS and current public origin to a fresh reviewed durable one-attempt guard. Obtain separate explicit permission for **one invitee confirmation only**; do not reset a previously consumed authorization.
5. Obtain separate OTP approval later if live guest email proof is requested. Google Calendar writes also require separate approval.

Current main application: `http://localhost:3001/bookings`. The isolated booking is intentionally absent from the main database. The temporary local fixture server was stopped after verification; there is currently no external joining URL.
