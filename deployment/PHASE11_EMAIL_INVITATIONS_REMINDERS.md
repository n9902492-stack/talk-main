# Phase 11 — booking invitations and reminder emails

Implemented and tested locally on 22 October 2026. **Real external delivery was not authorized or performed. Scheduling SMTP, Gemini AI and the public tunnel remain unchanged/disabled as applicable.**

## Audit: what existed

The scheduling rebuild already had transactional job creation, an explicitly disabled SMTP adapter, UTC ICS attachments, hashed browser management credentials, guest email proof and waiting-room admission. The worker persisted leases/retry counts and cancelled superseded jobs.

Missing behavior: only the invitee received a generic confirmation, there was one one-hour reminder rather than meeting-day/15-minute reminders, the email omitted its joining link, and hosts received no scheduling notifications. Rescheduling queued another generic confirmation; cancellation suppressed jobs but sent no cancellation message. The browser credential was only hashed in the database, so a durable worker could not safely reconstruct its link.

## Added/fixed

- Dedicated host and invitee plaintext/HTML templates for confirmation, rescheduling, cancellation, meeting-day and 15-minute reminders, with recipient and host timezones explicitly displayed.
- A unique purpose-bound invitation link for each booking/version. A dedicated server secret derives the email credential using HMAC-SHA256. No plaintext bearer credentials, rendered bodies, signing keys or LiveKit tokens are stored in job rows.
- Host links open the associated Talk meeting through existing authenticated host access. Invitee links open private booking confirmation and still require email proof, the join window and host admission. Group members share the scheduled meeting while retaining separate private booking credentials.
- Email-link authorization works with existing booking details, cancellation/rescheduling and guest proof. Rescheduling rotates both browser and email access; cancellation invalidates email access. A cancellation response is produced from the already-authorized booking, avoiding a rollback caused by checking its newly revoked credential again. Guest responses never include host-only qualification answers.
- Role-specific durable reminders, cancellation notifications and rescheduling notices. Pending old-version jobs are cancelled in the same booking transaction; completed history is retained.
- Safe upgrade of pending legacy `confirmation`/`reminder` jobs when delivery is later enabled. Legacy rows are retained as cancelled; replacement jobs use unique keys. Previously delivered invitee confirmations are not replayed by this upgrade; future bookings with completed legacy messages receive missing host notification and applicable new reminders.
- A long-open confirmation page refreshes an expired form challenge once, only after an explicit rejection before the booking handler ran. SMTP failures, network failures and ambiguous timeouts are not automatically retried by the browser.

## Templates

| Event | Subject | Host content / action | Invitee content / action |
| --- | --- | --- | --- |
| New booking | `Talk - Booking confirmed: <title>` | Invitee name/address, both times; **Open host meeting**, requiring sign-in | Host name, both times; **View booking and join**, private link |
| Rescheduled | `Talk - Booking rescheduled: <title>` | Updated time and authenticated host meeting link | Updated time and newly derived private link; old link revoked |
| Cancelled | `Talk - Booking cancelled: <title>` | Cancellation details, no join action | Cancellation details, no join action |
| Meeting day | `Talk - Meeting today: <title>` | Host-local day/time and host link | Invitee-local day/time and private link |
| 15 minutes before | `Talk - Meeting reminder: <title>` | Host access and times | Private confirmation/join access and times |

Every message includes a UTF-8 ICS attachment using the existing booking UID and version/SEQUENCE. Cancellation uses `METHOD:CANCEL` and `STATUS:CANCELLED`. Bearer credentials are in the private email action link, not the ICS attachment. Importing or removing external calendar entries remains calendar-client behavior; no Google/Outlook calendar API is invoked.

Templates escape HTML, normalize subject line breaks and omit qualification responses and other group attendees. Invitee messages do not disclose the host's private email address. Separate messages avoid CC/BCC disclosure.

## Reminder policy

- **Meeting-day reminder:** 09:00 in each recipient's own timezone. Appointments before 09:30 use local midnight so the day reminder can precede the final reminder. UTC instants are calculated from IANA timezone rules, including DST gaps/folds and half-hour offsets.
- **Final reminder:** scheduled 15 minutes before the meeting, at the same absolute instant for both roles.
- A late booking can receive an overdue reminder promptly. The day reminder is omitted if its planned delivery would be less than 15 minutes before the final reminder. A booking within 15 minutes gets a prompt final reminder rather than a fabricated earlier delivery. No reminder is sent after meeting start.
- Day jobs expire at the 15-minute boundary; final reminder and confirmation/rescheduling jobs expire at meeting start. Cancellation notices expire after 24 hours.
- The worker checks due jobs every 30 seconds while Talk runs. This is due-time scheduling, not a guarantee of delivery at an exact second. Laptop sleep, shutdown, SMTP delays or provider quotas can delay or suppress delivery. On restart, still-relevant due jobs resume; expired notices are suppressed.

## Durable architecture and schema

Existing `scheduling_jobs` is extended, not replaced:

- SQLite migration `backend/src/migrations/015_scheduling_email.sql`.
- PostgreSQL migration `backend/src/postgres-migrations/013_scheduling_email.sql`.
- Added `recipient` (`host`/`invitee`) and `expires_at`. Existing rows/data remain intact.
- Kinds encode role, for example `confirmation:host`, `reminder_day:invitee`, `reminder_15:host`, `rescheduled:invitee`, `cancellation:host`. Existing `(booking_id, booking_version, kind)` uniqueness therefore covers each notification/recipient.

Job insertion shares the booking transaction. Workers claim under the existing host transaction lock, recheck booking version/status/expiry, reserve a 60-second lease and refresh it during active SMTP dispatch. Separate workers cannot claim an unexpired lease. A stopped process leaves a recoverable expired lease. Up to three attempts use a one-minute retry delay, bounded by notice expiry; failures persist sanitized error codes. Sent jobs remain sent across restarts. Fixed Message-ID values assist deduplication.

Status is checked again immediately before dispatch. An email already accepted/in flight cannot be recalled by cancellation. SMTP can also accept a message just before a process dies without recording `sent`; a recovery retry can duplicate that uncertain delivery. Exactly-once delivery is not claimed. Operator job monitoring/retry UI is not included in this change.

New modules: `email-links.mjs`, `email-outbox.mjs`, `email-schedule.mjs`, `email-templates.mjs`. Targeted edits: `service.mjs`, `guests.mjs`, `jobs.mjs`, `transport.mjs`, `frontend/src/lib/scheduling.ts`, `.env.example`, package test scripts, fixtures and migration-count assertions. Main authentication, LiveKit credentials, meeting/media components, recordings and whiteboards were not rewritten.

Source checkpoint: `artifacts/backups/phase11-email-1792686403831/`. It contains the affected pre-change source, not private environment credentials. Keep additive tables and booking/job history when rolling back; restore only these integration changes after checking for later user edits. Do not roll back production migrations or remove booking data.

## Validation

| Check | Result |
| --- | --- |
| Scheduling + email tests | 44 passed, 0 failed; includes 24 new email tests |
| Broad backend regression including the above | 267 passed, 0 failed, 0 skipped |
| Browser request refresh / no-send-retry tests | 3 passed, 0 failed |
| TypeScript/repository lint | Passed |
| Production frontend build | Passed; existing bundle-size/timing warnings |
| Existing scheduling/guest media browser workflow | Passed after expired-form refresh fix |
| Real Gmail SMTP | **NOT RUN** |
| PostgreSQL execution | **UNVERIFIED**; pre-existing local Docker engine blocker remains |

The focused 44 tests overlap the broad 267 and must not be added to it. The final backend/client total is 270 passed. An earlier run encountered two transient local `fetch failed` errors in the unchanged assistant tests; that file passed all 23 tests on isolated recheck and the final full run passed. An SMTP fixture expectation was corrected to preserve internal whitespace in non-Gmail passwords. The initial browser run exposed the expired-form issue described above. A subsequent fixture run advanced far enough to expire the normal host session, correctly denying joining; the browser fixture now uses all-day availability instead of a large simulated time jump. Its final rerun passed.

New tests cover actual SQLite close/reopen and worker reconstruction, stable email links, stale leases, completed-job preservation, SMTP retry persistence, concurrent workers with a raw non-deduplicating capture mock, both recipient timezones, DST, revocation, cancellation ICS, legacy pending-job conversion, expired reminders and HTML escaping. Mock SMTP uses Nodemailer's local stream/MIME compiler to inspect plaintext, HTML, ICS and fixed Message-ID without opening a connection. HTTP integration uses captured mock messages and codes. A process-level egress guard blocks external test traffic.

Evidence: `artifacts/qa/phase11-email-focused.tap`, `phase11-email-regression.tap`, `phase11-email-client.tap`, `phase11-email-typescript.log`, `phase11-email-build.log`, `phase11-email-browser.log`. The browser workflow additionally verifies persisted booking, mocked email proof, waiting-room admission, real local LiveKit audio/video reception, synthetic screen sharing, chat, reconnection and removal. It does not establish remote physical-device or real email delivery success.

## Enabling Gmail later — preparation only

No settings below were activated. Configure only in the backend's Git-ignored local environment, never in `VITE_` variables or chat:

```dotenv
SCHEDULING_EMAIL_ENABLED=false
SCHEDULING_PUBLIC_URL=http://localhost:3001
SCHEDULING_EMAIL_LINK_SECRET=<dedicated-random-32-byte-base64url-secret>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<sending-Gmail-address>
SMTP_PASSWORD=<Gmail-app-password>
SMTP_FROM="Talk <sending-Gmail-address>"
```

Use a stable cryptographically random signing secret, generated locally and entered without logging it. Keep it across restarts; changing it invalidates old emailed credentials. The adapter refuses activation if its URL/key or existing SMTP configuration is missing/invalid. Public origins must use HTTPS; HTTP is accepted only for loopback testing.

Google requires 2-Step Verification for App Passwords, and account/Workspace policies may make them unavailable. Use an App Password rather than the normal account password; do not enable less-secure sign-in. See [Google's App Password guidance](https://support.google.com/mail/answer/185833?hl=en). This adapter uses `smtp.gmail.com:587` with mandatory STARTTLS, TLS certificate verification and logging disabled; see [Google SMTP documentation](https://developers.google.com/workspace/gmail/imap/imap-smtp?hl=en).

Before any real send: review sender/recipient addresses and pending legacy/current jobs, verify the advertised app origin is reachable by the intended recipients, obtain explicit delivery approval, then enable scheduling SMTP and restart only the authorized normal local app. Enabling the worker can release all still-eligible queued notices; it is not limited to one test email. Plan an isolated controlled booking for an initial delivery test. Gmail account/provider limits still apply.

**Do not change the existing public tunnel for this step.** Localhost links work only on the laptop running Talk. Team email invitations require a separately approved HTTPS origin that actually serves scheduling; the existing restricted WebRTC tunnel does not enable scheduling. Keep the laptop and Talk running for reminders. No deployment or paid service is needed for local mock testing.

Local testing URL: **http://localhost:3001/bookings**. Automated mock checks: `npm run test:scheduling:email`, `npm run test:scheduling:client`, `npm run test:scheduling:browser`. Public booking links are `/booking/<host-handle>/<event-slug>`. Delivery is currently disabled, so manual bookings persist and queue jobs without sending external mail.
