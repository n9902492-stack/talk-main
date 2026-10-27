# Phase 11 approved isolated booking switch — blocked public verification

**Superseded after separate approval:** A replacement temporary tunnel with independent processes is now verified, and the new booking's HTTPS page/ICS/private preview passed. See `PHASE11_SMTP_RELIABILITY_HTTPS_RESTORED.md`. The failure below is preserved as historical evidence; its old hostname remains unusable. No email was sent during either task.

24 October 2026, Asia/Kolkata. **No real email, OTP, SMTP connection, Calendar invitation/API write or replacement tunnel was started.**

## Result and blocker

The new synthetic fixture passed local restricted-route preflight, but the existing Cloudflare connector did not survive termination of its owning server controller. The newly bound isolated listener failed its HTTPS health check and was immediately closed. **Public verification and the final HTTPS email preview are blocked. Exactly one live Gmail confirmation is not ready for approval yet.**

Last origin: `https://bathroom-fully-rear-lucia.trycloudflare.com`. It was HTTP 200 before the switch and is now unreachable. Do not use it in an email. There is no currently verified usable HTTPS joining URL.

The user expressly required stopping if the existing tunnel could not remain healthy, and prohibited automatically starting another tunnel. No replacement was started and no attempt was made to obtain another hostname.

## Verified sequence

1. Actual time was checked at 12:56 PM IST on 24 October; the 3:45 PM booking was upcoming. Existing HTTPS health, five-email allowlist and the separate database/invitation preflight passed.
2. Previous port 3003 listener was loopback-only, owned by Node PID 5168 running `start-confirmation-test-tunnel.mjs`. Existing cloudflared PID was 24668. The main port 3001 application was HTTP 200.
3. A source/state checkpoint was created under `artifacts/backups/isolated-booking-switch-20261024-125747/`.
4. The first switch preflight stopped without changing any service because the old scheduled meeting row was `active`. Read-only inspection confirmed zero host connection rows and zero guest connection rows, including historical rows. Talk creates an active meeting row during booking, before anybody joins or a live room is created. The idle check was corrected to require this stronger, never-issued-media-ticket evidence. The old meeting row was not changed.
5. Strict support for the new marked SMTP reliability fixture was added to the isolated-only runtime factory. Exactly one synthetic account/booking, approved names/title, allowlisted host/guest, one unsent confirmation job and disabled delivery are enforced. Existing route, cookie, origin and authorization restrictions remain in force. No production authentication or meeting handler was replaced.
6. The new fixture was tested on an ephemeral loopback listener with the existing HTTPS Host/protocol configuration. Signed detail and calendar routes, safe cookies, invalid credential rejection, cross-booking restriction, untrusted origin rejection, private-route denial, OTP disabled status and email-worker disabled status passed. This ephemeral listener was closed before the actual switch.
7. The old Node controller was terminated and the new isolated process bound **127.0.0.1:3003**. Cloudflared was not explicitly stopped or restarted. The subsequent HTTPS health check failed. Read-only checks then confirmed both the old connector PID 24668 and new server PID 16360 had exited. Neither port 3003 nor cloudflared's loopback metrics port 20244 remained listening.
8. The new isolated listener was closed by the fail-closed handler. The connector's exact exit diagnostic was not captured after its owning controller exited; a specific OS job/pipe cause is therefore not proven. The observed parent-process coupling was not accounted for adequately before stopping the controller. An additional preflight now refuses to stop a controller that is the connector's parent. That safeguard has been syntax-checked but no further switch/restart was attempted.
9. Local state metadata was updated to `running:false, connected:false` so it does not falsely advertise a healthy tunnel. The original state snapshot is preserved in the checkpoint. Main localhost:3001 remains HTTP 200.

## Current booking and data

| Field | Status |
| --- | --- |
| Title | SMTP Reliability Test |
| Booking ID | `6ecc6490-aec8-4f19-8ffd-ffe7e5b82870` |
| Date/time | **24 October 2026, 3:45–4:15 PM IST** |
| Timezone | Asia/Kolkata |
| Joining window | **3:30–5:15 PM IST** |
| Invitation expiry | **5:15 PM IST**, rejected afterward |
| New SQLite database | `data/smtp-reliability-test/run-9MbE1g/talk.sqlite` |
| Account / booking counts | Exactly one synthetic account and one synthetic booking |
| Host | Talk Synthetic Reliability Host |
| Guest | Synthetic Reliability Guest |
| Sender / recipient | `niknikhil.sharma22@gmail.com` |
| Existing Message-ID | `<d25c45a7-dd32-4af6-85d4-6bd6f3d2472e@talk.local>` |
| New guard | `data/smtp-reliability-test/run-9MbE1g/send-attempt-guard.sqlite` |
| Guard status | `awaiting_public_verification`, consumed **0** |
| Main app | **http://localhost:3001/**, HTTP 200 |
| Isolated server | Stopped after failed public health verification |
| Existing tunnel | Offline; no replacement started |

The booking time, duration, signing credential, Message-ID and unused guard were not replaced. New local fixture preparation added the marker `.synthetic-smtp-reliability` and a password identity belonging only to the synthetic host. Its generated password is stored only in the fixture's ACL-restricted, Git-ignored `host-access.private.json`; it is not the real Gmail password. Live host login through the final HTTPS origin was not verified because public verification was blocked.

No old booking was copied into the new runtime database, recreated, cancelled or deleted. The previous booking is still confirmed with its original 2:15–2:45 PM times and zero durable outbox attempts. Its separate historical one-shot ambiguous guard remains consumed. SHA-256 checks confirm the old consumed guard, original SMTP result, `.env.local` and `.env.tunnel-test.local` are unchanged. Main databases and LiveKit credentials were not edited.

## Security and test results

**68 automated tests passed, 0 failed. One operational HTTPS-health check failed and blocks completion.**

Executed with external network egress blocked:

```powershell
node --import ./tests/helpers/cloud-egress-guard.mjs --test --test-concurrency=1 tests/booking-link-test.test.mjs tests/smtp-delivery-reliability.test.mjs tests/confirmation-send-guard.test.mjs tests/scheduling-email-templates.test.mjs tests/scheduling-email-transport.test.mjs tests/scheduling-email-jobs.test.mjs tests/scheduling-served-preview.test.mjs tests/scheduling-server.test.mjs
```

Coverage includes booking authorization, signing without SMTP, tampering/foreign/expired/revoked access, persistence, exact-origin validation, secure cookie prefixes, CSRF, five-email allowlist, rate limiting, mandatory email proof, one-time OTP consumption/cooldown/expiry/attempt limits using mocks, guest waiting room and host admission using mocked local proof, private-resource isolation, email templates, ICS, SMTP outcomes, interrupted workers and consumed duplicate guards. Two new tests exercise the new SMTP reliability fixture's restrictions and email-proof/admission requirements.

The prior 217-test reliability regression/build report remains historical evidence; the 68-test run is the actual targeted run for this switch. The two runs overlap and must not be added together as distinct tests.

SMTP instrumentation still supports persistent connection/TLS/AUTH/submission/DATA/final acknowledgment diagnostics and the four safe outcomes. Ambiguous outcomes cannot auto-retry. The targeted tests verify those properties using mocks. **No Gmail SMTP connection or authentication was made.** Offline SMTP configuration was previously valid and the environment hashes are unchanged; no fresh live authentication success is claimed.

| Verification | Result |
| --- | --- |
| New database/identity/booking association | PASS locally |
| Signed link and full-window expiry | PASS offline and local route |
| Tampered, expired, revoked, cross-booking rejection | PASS mock/local tests |
| Mandatory guest proof and host admission | PASS mock/local tests; real OTP disabled |
| Cookies, CSRF, origin, allowlist and rate limits | PASS mock/local tests |
| New confirmation page over public HTTPS | BLOCKED |
| New signed-link POST over public HTTPS | BLOCKED |
| ICS download over public HTTPS | BLOCKED |
| Existing ICS exact date/time | PASS offline; unchanged |
| Same-tunnel survival after runtime restart | FAILED |
| Main app and original consumed guard preserved | PASS |

## Preview and ICS

No new final email with an inaccessible hostname was generated. The existing **offline, non-sendable** drafts remain:

- `data/smtp-reliability-test/run-9MbE1g/confirmation.draft.html`
- `data/smtp-reliability-test/run-9MbE1g/confirmation.draft.txt`
- `data/smtp-reliability-test/run-9MbE1g/talk-booking.ics`

Subject: **Talk - Booking confirmed: SMTP Reliability Test**.

Sender and recipient: `niknikhil.sharma22@gmail.com`.

The draft contains Talk branding, synthetic host/guest, 24 October 3:45–4:15 PM Asia/Kolkata, 30-minute duration, calendar instructions, mandatory email verification and host-admission instructions. Its link remains `[SECURE_TALK_JOIN_LINK_PENDING_PUBLIC_APPROVAL]`. Reschedule/cancellation are explicitly unavailable in this isolated test.

The ICS contains `DTSTART:20261024T101500Z` and `DTEND:20261024T104500Z`, exactly matching the booking. It includes no private invitation credential and causes no Calendar API call. The private invitation itself remains in the existing restricted local file; no credential was printed or included in this report.

## Files and evidence

Changed/new source files for this switch:

- Modified `backend/src/scheduling/booking-link-test.mjs` — narrow marked-fixture support; existing public-route restrictions retained.
- Modified `tests/booking-link-test.test.mjs` — two new reliability-fixture security/admission tests.
- New `scripts/smtp-reliability-switch-config.mjs` — scoped synthetic-data/configuration validation and private synthetic host identity preparation.
- New `scripts/switch-approved-smtp-reliability-runtime.mjs` — isolated-only preflight/restart/fail-closed runner, no tunnel start capability; now refuses a connector-parent dependency.
- New `scripts/verify-smtp-reliability-switch-https.mjs` — prepared but not executed; guarded HTTPS/ICS/browser verification and private final-preview generation. It cannot send SMTP or OTP. It must not run until public access is separately restored and verified.
- This report and the latest-status note in `deployment/PHASE11_SMTP_DELIVERY_RELIABILITY.md`.

Evidence:

- `artifacts/qa/smtp-reliability-switch-security.tap` — 68/68 passed.
- `artifacts/qa/smtp-reliability-switch-runtime.json` — failed stage `preserved tunnel health`, zero emails/OTPs/Calendar writes.
- `artifacts/qa/smtp-reliability-switch-runtime.stdout.log`, `.stderr.log` — privacy-safe lifecycle output.
- `artifacts/qa/smtp-reliability-health.json` — main 200, isolated and old HTTPS unreachable.
- `artifacts/qa/smtp-reliability-preservation-after.json` — original guard/result/env hashes unchanged, new guard unused, invite valid, automatic SMTP off.

## Approval required

Per the user's Step 2 and Step 4, work stopped after the tunnel failed. To continue public testing, **separate approval is required to start a replacement temporary Cloudflare Quick Tunnel and isolated loopback server, with independent connector/server lifecycles**. Do not silently reuse the old unreachable hostname. Recheck the booking window first; if it has passed, stop rather than creating or rescheduling a booking without authorization.

After separately approved public access is established, verify the new confirmation page, signed-link authorization and ICS download, then prepare/review the final private email with the fresh reachable origin and bind its exact content to the unused guard. Sending exactly one confirmation still requires a further explicit email-send approval. OTP delivery remains separately disabled and would need its own approval. No live delivery, retries, host notifications, reminders, SMS, recording/transcription, Gemini, Calendar writes, deployment or paid services have been enabled.
