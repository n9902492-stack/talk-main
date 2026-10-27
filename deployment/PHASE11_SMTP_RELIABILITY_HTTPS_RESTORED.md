# Phase 11 independent temporary HTTPS runtime and final email preview

**Latest status:** The user subsequently approved exactly one real confirmation attempt. It was SMTP-accepted with final code 250; the new guard is now consumed and general delivery remains disabled. See `PHASE11_SMTP_RELIABILITY_REAL_SEND_RESULT.md`. The rest of this report preserves the earlier HTTPS/preview preparation; its unused-guard status is historical, not permission to send again.

24 October 2026, Asia/Kolkata. This work used the user's explicit approval to start a replacement temporary Quick Tunnel and independent isolated server. **No real email, OTP, SMTP connection, Calendar API write, deployment or paid service was enabled.**

## Current result

Temporary HTTPS origin: **https://knights-downloaded-phil-copyright.trycloudflare.com**.

The actual synthetic booking confirmation page, signed-link verification and browser ICS download passed through this origin. The final private email preview uses only the new hostname. The unique Message-ID and unused send guard were preserved. The old ambiguous-send record and its consumed guard are unchanged.

The preview is ready for **separate explicit approval of one invitee confirmation email**, subject to a fresh time/link/tunnel check immediately before any authorized attempt. This document does not authorize sending. Offline SMTP configuration is valid; Gmail authentication and acceptance were not tested during this work. Guest OTP delivery remains disabled and requires separate approval, so real guest email verification cannot yet complete.

## Independent processes and lifecycle proof

| Component | Current process | Binding / scope |
| --- | --- | --- |
| Isolated Talk server | Node PID **13628**, parent PID 25056 | **127.0.0.1:3003** only |
| Temporary Cloudflare connector | cloudflared PID **14664**, parent PID 20744 | Targets only `http://127.0.0.1:3003` |
| Connector readiness endpoint | Owned by PID 14664 | **127.0.0.1:20244**, `/ready` HTTP 200 |
| Main application | Existing service preserved | **http://localhost:3001/**, HTTP 200 |

The processes were started in separate hidden `Start-Process` launches. The Node server never starts, owns, stops or restarts cloudflared. Cloudflared writes directly to separate local files rather than to a pipe owned by the Node server controller. Sensitive application environment variables were removed from the connector's launching process environment only; environment files and stored credentials were not modified.

Actual lifecycle verification was performed **before opening the booking routes**:

1. Bootstrap Node PID 25792 bound only to loopback port 3003 and returned 503 while waiting for a verified public origin.
2. Cloudflared PID 14664 registered the new temporary hostname, independently of that Node process.
3. Process and listener identity checks confirmed the connector was not a child of the server.
4. Bootstrap server PID 25792 was stopped. The **same connector PID and creation time survived**, and its `/ready` endpoint remained HTTP 200.
5. New independent Node PID 13628 started with routes still closed.
6. Only after that proof was recorded was the new origin committed to the protected backend runtime configuration. The server then enabled only its existing strict synthetic-booking route allowlist.

There was one Quick Tunnel creation for this task, and no connector restart during this lifecycle test. The old unreachable hostname was not reused.

Runtime state is in `data/booking-link-test/confirmation-public-tunnel.json`. It records `independentlyManaged:true`, the two PIDs, the exact synthetic database, new origin and disabled-service flags. This is bookkeeping; health should always be probed rather than inferred solely from a state file.

The protected launch/session directory is:

`data/smtp-reliability-test/run-9MbE1g/independent-runtime-vP7D5O/`

The same path is recorded in `artifacts/qa/smtp-reliability-independent-launch.json`. It contains process start records, `independence-proof.json`, the origin binding and separate server/connector logs. No private booking credential is printed in those logs.

## Existing booking and database

| Field | Verified value |
| --- | --- |
| Title | **SMTP Reliability Test** |
| Booking ID | `6ecc6490-aec8-4f19-8ffd-ffe7e5b82870` |
| Database | `data/smtp-reliability-test/run-9MbE1g/talk.sqlite` |
| Synthetic host | Talk Synthetic Reliability Host |
| Synthetic guest | Synthetic Reliability Guest |
| Date | **24 October 2026** |
| Time | **3:45–4:15 PM IST** |
| Timezone / duration | Asia/Kolkata / 30 minutes |
| Joining window | **3:30–5:15 PM IST** |
| Invitation expiry | **5:15 PM IST**, rejected afterward |
| Sender and recipient | `niknikhil.sharma22@gmail.com` |

The booking was not recreated, rescheduled, duplicated or cancelled. The runtime uses the existing separate SQLite file containing exactly one synthetic account, event, booking and scheduled Talk meeting. It does not load the main application database or the previous test database.

The existing backend signing secret was reused without exposing it. The private invitation is booking/version bound and remains valid throughout the scheduled joining window. No long-lived LiveKit media token was generated for the email. Email verification and host admission remain mandatory.

`SCHEDULING_PUBLIC_URL` is set only in the isolated Node process to the new origin. The origin-binding file lives in the protected runtime session directory. Neither `.env.local` nor `.env.tunnel-test.local` was edited.

## HTTPS and security verification

The public verifier reported all 12 verification groups **PASS**:

- HTTPS health and the same independent connector.
- Correct signed invitation and exact new booking association.
- Invalid/tampered credentials and foreign/old booking route rejection.
- Expired and revoked invitation rejection, followed by exact restoration.
- Guest proof required, five-email allowlist and private-route isolation.
- Secure prefixed cookies, HttpOnly, SameSite=Lax, CSRF and exact-origin validation.
- Actual browser confirmation page and ICS download in a secure context.
- Synthetic host password login and CSRF rejection on unauthenticated writes.
- Final private preview and unused guard.
- Persistent SMTP diagnostic readiness using offline mocks only.
- Rate limiting and host-admission enforcement using local mock tests.
- Main application, environment files and original ambiguous guard preserved.

The browser displayed the new meeting title, correct 3:45–4:15 PM date/time, Asia/Kolkata, the synthetic invitee and the intentional “Guest verification email is not configured” notice. The private fragment was removed from browser history after loading. No OTP send button was available.

For expired/revoked-link checks, only the idle new synthetic invitation rows were temporarily expired/revoked and then restored in `finally` blocks. Their exact original expiry/revocation fields were saved privately and restored; the scheduled meeting times were never changed. No live media tickets existed. The previous booking and its invitation were not modified.

The allowlist still contains exactly five approved emails. Requests from an outside email were rejected. Unrelated scheduling dashboards, delivery history, Google authentication/Calendar, phone send, private recordings and whiteboard APIs remained unavailable. The isolated route set was not broadened to expose main application resources.

Actual public email-proof bypass attempts were rejected. Waiting-room/host-admission behavior was validated using local mocked proof, not a real Gmail OTP or a new live video session. No real end-to-end guest join is claimed in this task.

## ICS verification

Both the attachment and the browser's actual HTTPS download contain:

```text
UID:6ecc6490-aec8-4f19-8ffd-ffe7e5b82870@talk.local
DTSTART:20261024T101500Z
DTEND:20261024T104500Z
```

Those UTC times are exactly **3:45–4:15 PM IST**. Both match the database's start/end and booking UID. The prepared attachment's original DTSTAMP remains stable for the send fingerprint. The downloaded calendar may have a later generation timestamp; its meeting identity and scheduled times match exactly. Neither file contains an invitation credential. This is a local `METHOD:PUBLISH` attachment, not a Google Calendar API write or external invitation send.

## Final email preview

Sender: **niknikhil.sharma22@gmail.com**  
Recipient: **niknikhil.sharma22@gmail.com**  
Subject: **Talk - Booking confirmed: SMTP Reliability Test**

Message-ID preserved: `<d25c45a7-dd32-4af6-85d4-6bd6f3d2472e@talk.local>`.

Complete, private, Git-ignored previews:

- `data/smtp-reliability-test/run-9MbE1g/confirmation.https.private.html`
- `data/smtp-reliability-test/run-9MbE1g/confirmation.https.private.txt`
- `data/smtp-reliability-test/run-9MbE1g/confirmation.https.private.json`
- Attachment: `data/smtp-reliability-test/run-9MbE1g/talk-booking.ics`

Credential-masked previews for review/reporting:

- `data/smtp-reliability-test/run-9MbE1g/confirmation.https.masked.html`
- `data/smtp-reliability-test/run-9MbE1g/confirmation.https.masked.txt`

The parent fixture directory retains its restricted Windows ACL and Git-ignore protection. Complete private links remain only in protected local files. No private joining credential, password, OTP, signing secret or SMTP body is emitted to diagnostic logs or included in this report.

Readable preview:

```text
Hi Synthetic Reliability Guest,

Your meeting with Talk Synthetic Reliability Host is confirmed.

Meeting: SMTP Reliability Test
Duration: 30 minutes
Invitee time: Saturday, October 24, 2026 at 3:45 PM -
              Saturday, October 24, 2026 at 4:15 PM (Asia/Kolkata)
Host time: the same Asia/Kolkata time
Host: Talk Synthetic Reliability Host

View booking and join:
https://knights-downloaded-phil-copyright.trycloudflare.com/booking-confirmation
  ?id=6ecc6490-aec8-4f19-8ffd-ffe7e5b82870#[PRIVATE_CREDENTIAL]

Add to calendar: Open the attached talk-booking.ics file in your calendar app
to add or update this meeting.

Rescheduling and cancellation are unavailable in this isolated test.
Contact the host if you need changes.

Keep this private booking link to yourself. Talk will verify your email
before guest access; the host may need to admit you from the waiting room.

Talk
```

The masked URL above is documentation, not a usable invitation. The existing Talk-branded HTML template is preserved. An offline audit verified that every trycloudflare hostname in the final HTML/plain text is the new origin, with no stale hostname, localhost URL or pending-link placeholder.

Reschedule/cancel endpoints intentionally remain blocked in this restricted runtime. The email explicitly says those actions are unavailable. The existing confirmation UI still displays its normal management buttons, but those actions cannot execute in this isolated environment.

## Send guards and SMTP readiness

The existing new guard file is unchanged in identity/location:

`data/smtp-reliability-test/run-9MbE1g/send-attempt-guard.sqlite`

Its state is now **`awaiting_approval`, consumed 0**. Preparation bound the exact new-origin message, original ICS bytes, recipient and Message-ID to a new content fingerprint in the same unused guard row. This is not a send reservation or authorization. The fixture manifest and private preview contain the matching fingerprint. Outbox attempts remain **0** and no delivery-attempt row exists for this real fixture. Host and reminder jobs remain cancelled.

The original ambiguous-send guard remains consumed, with `failed_or_acceptance_unknown`. Its file and the original send-result JSON match their preservation hashes. It was not reset, reused, reserved or retried.

Offline tests confirm persistent connection/TLS/AUTH/submission/DATA/final-ack phase diagnostics, fixed safe response categories, explicit accepted/rejected/not-submitted/ambiguous outcomes, privacy filtering and no automatic retries for ambiguity. SMTP acceptance is distinct from inbox delivery. No Gmail SMTP connection/authentication was performed here; a later specifically authorized send must perform its own current preflight and record the actual acknowledgment or uncertainty.

General SMTP, OTP, automatic reminders/host notifications, SMS, recording/transcription, Gemini and live Google Calendar operations remain disabled in the isolated runtime. No main application feature setting or existing email worker was activated or reconfigured.

## Tests and evidence

**68 automated security/booking/email tests passed, 0 failed, 0 skipped**, in 49.1 seconds, with external egress blocked. They cover booking authorization, signed-link expiry/revocation/tampering, allowlist, secure cookies, CSRF/origin/rate limits, guest proof and host admission, templates, ICS, SMTP outcomes/timeout/crash recovery and duplicate guards.

Additional actual verification: **12 HTTPS verification groups PASS**, independent process-stop survival PASS, and the final read-only preview/guard/preservation audit PASS. The final public verifier completed at **1:23:50 PM IST**, with explicit Node exit code **0**. These groups are not added to the 68 unit/integration cases as if they were distinct test-suite cases.

Evidence:

- `artifacts/qa/smtp-reliability-independent-security.tap`
- `artifacts/qa/smtp-reliability-switch-https.json`
- `artifacts/qa/smtp-reliability-independent-https.log`
- `artifacts/qa/smtp-reliability-independent-https-final.log`
- `artifacts/qa/smtp-reliability-independent-preview-audit.json`
- `artifacts/qa/smtp-reliability-public-confirmation.png`
- Protected runtime directory's `independence-proof.json`, `connector-start.json`, `final-server-start.json`, `server-state.json` and separate process logs.

The prior 217-test implementation report is historical and overlaps these suites. No frontend code changed in this task, so the already validated isolated frontend build was reused; no new production deployment/build swap was made.

New/updated source:

- `scripts/smtp-reliability-switch-config.mjs` — explicit prepared-origin loading while retaining all fixture/guard checks; live verification still requires healthy runtime state.
- `scripts/prepare-independent-smtp-runtime.mjs` — offline/local preflight only.
- `scripts/serve-independent-smtp-runtime.mjs` — independent loopback server, initially fail-closed, no connector management capability.
- `scripts/configure-independent-smtp-origin.mjs` — capture the assigned hostname and commit it only after lifecycle proof.
- `scripts/verify-independent-smtp-preview.mjs` — read-only exact-preview/ICS/guard/preservation audit.
- This report and latest-status notes in the earlier reports.

Existing `scripts/verify-smtp-reliability-switch-https.mjs` performed the public/browser verification and private preview preparation. Main authentication, LiveKit, Google Calendar, analytics, recording/transcription and whiteboard source/configuration were not changed in this task.

## Remaining limitations and next authorization

1. **No email is authorized or sent.** Exactly one invitee confirmation can be considered after separate explicit approval and a fresh upcoming-meeting, live-link, guard and SMTP preflight. No host/reminder/OTP/cancellation/reschedule email or automatic retry is permitted by this preparation.
2. Guest Gmail OTP delivery remains disabled. A recipient can open the valid confirmation and download ICS, but cannot complete live guest email verification until a separately approved controlled OTP test is prepared/enabled. Host admission is still required afterward.
3. The hostname is temporary. Do not assume it will remain available later. If it dies or the meeting/window passes, stop and obtain the required approval rather than silently changing the link or booking.
4. The isolated reschedule/cancel limitation described above remains intentional. No real media session was retested in this HTTPS-only preparation.

Stop here. Do not send, retry, enable delivery, deploy or make Calendar writes without the user's next explicit authorization.
