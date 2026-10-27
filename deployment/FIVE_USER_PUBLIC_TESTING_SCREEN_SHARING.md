# Five-user public testing and screen sharing

Audit date: 24 October 2026 (Asia/Kolkata). This document separates local synthetic evidence from public and external-device verification.

**Subsequent approved public launch:** see `deployment/FIVE_USER_PUBLIC_RUNTIME.md`. A new isolated runtime and HTTPS origin were verified after this offline report. The results below describe the earlier offline audit; they are retained as historical evidence. Three existing verified accounts are available in the new runtime; the other two still require normal verification with separately approved email delivery.

## Final results

| Requested check | Result |
| --- | --- |
| Public website access | **FAIL / blocked**: existing server and origin unreachable |
| Five-user authentication | **PASS locally with mocked email proof**; **FAIL / blocked publicly** |
| Five-participant local meeting | **PASS**: one host and four independent synthetic users |
| Local screen sharing | **PASS**: native synthetic tab received and decoded by all four other participants |
| LiveKit Cloud connectivity | **NOT TESTED**: configured endpoint identified, actual test used loopback SFU |
| Public screen sharing | **NOT TESTED** |
| Five real external devices | **NOT TESTED** |
| Unit/integration regressions | **96 passed, 0 failed** |
| Final browser suites | **2 passed**; earlier removal assertion failure retained separately |
| TypeScript | **PASS** |
| Production build | **PASS**, isolated output; existing large-chunk warning remains |
| Real messages sent during this task | **0** |

Latest read-only public check: **24 October 2026, 15:26:41 IST**. No usable public testing URL is currently verified.

## Current public readiness

The existing isolated booking server at `127.0.0.1:3003` and the main application at `127.0.0.1:3001` were unreachable during this audit. The last assigned origin, `https://knights-downloaded-phil-copyright.trycloudflare.com`, was also unreachable. It is **not a currently verified testing URL**. No server or tunnel was restarted, replaced or exposed.

GET probes covered health, sign-in, sign-up, booking confirmation, dashboard, bookings, meetings, meeting and the scheduling dashboard API. All were unreachable. Evidence: `artifacts/qa/five-user-public-readiness.json`.

`data/booking-link-test/confirmation-public-tunnel.json` currently contains 720 NUL bytes and cannot be parsed. The last origin was obtained from the independently recorded launch/assigned-origin descriptors, not this invalid status file. The cause of the invalid status file is unconfirmed. No configuration was silently repaired.

The existing tester configuration contains five distinct allowlisted email addresses. Their values were read privately and are omitted here. A read-only database audit found three approved, verified accounts in `data/tunnel-test/talk.sqlite` and one approved, verified account in the SMTP booking fixture database. This does not establish that all five real users can currently authenticate.

## Scope and minimum safe public preparation

The current booking-link runtime is deliberately limited to one synthetic booking/meeting, a synthetic host and booking-specific guest authentication. It serves sign-in, confirmation, device-test and meeting pages, plus narrowly scoped guest/host APIs and the existing media signaling gateway. It does not provide general signup, the workspace dashboard, the Bookings page or the Meetings hub. Its one-guest fixture is insufficient for a five-person test.

The older five-email test adapter already enforces allowlisted signup/login, email proof, secure sessions, moderation and the signaling gateway. It does not yet expose the full scheduling/workspace routes required here, and its startup requires a configured mail adapter. It must not be launched with general Gmail sending merely to satisfy that requirement.

Before public testing, prepare a separate five-user runtime/database scope while preserving the SMTP reliability booking and both durable send guards. The reviewable scope is:

1. Serve the existing sign-in, sign-up, email-verification, Overview, Bookings, Meetings, pre-join and meeting frontend routes.
2. Allow only the required authentication/session endpoints, each user's own permitted scheduling/meeting resources, admission/moderation and the existing opaque-ticket signaling gateway. Keep unrelated private APIs blocked.
3. Preserve the exact five-email allowlist on signup, login and session use. Existing verified users use normal authentication; unverified users must complete the normal verification flow after separate email-send approval. Do not seed real accounts as verified or substitute test authentication in a public runtime.
4. Keep SMTP/OTP/reminders, SMS, recording, transcription, Gemini and live Calendar operations disabled. Decouple disabled delivery from startup rather than pretending that a real transport is enabled.
5. Bind to loopback, use an isolated cookie namespace, validate the exact HTTPS origin, retain Secure/HttpOnly cookies, CSRF, rate limits, guest email proof and host admission. Do not publish reusable LiveKit credentials or permanent media tokens.
6. Run local route/security regressions before separately approving a temporary tunnel. Verify the actual existing LiveKit Cloud project over public signaling and media; configuration alone does not prove connectivity or five-user capacity. No plan upgrades or paid resources are authorized.

This scope is a proposal only. No public routes were added. A separate runtime avoids replacing the narrow SMTP booking runtime while its controlled booking test is in progress.

## Local test evidence

- Existing security regression: **44 passed, 0 failed**, covering the test allowlist, secure sessions, CSRF/origin/rate controls, invitation validity, scoped guest access, host admission, meeting permissions/isolation and durable duplicate-send protection. Evidence: `artifacts/qa/five-user-security-regression.tap`.
- Actual configured allowlist test: **1 passed, 0 failed**. All five privately read addresses completed signup, mocked email proof, logout and password login in a disposable private database. Sessions and account IDs were distinct; an outsider was rejected; four users waited without tokens until admitted. The email adapter was in-memory. This proves local enforcement and session separation, not ownership of the real mailboxes or live provider verification. Evidence: `artifacts/qa/five-approved-auth.tap`.
- Five-browser media test uses five separate Chrome processes/contexts, synthetic verified account fixtures, generated camera/microphone sources, a disposable database, a random-port loopback LiveKit server and the real Talk signaling gateway. External requests are blocked. It does not connect to LiveKit Cloud or authenticate real Google accounts. Evidence and final status: `artifacts/qa/five-participant-browser.json`.
- Five-participant final media run: **PASS, 11 checkpoints**, including all-five admission, twenty decoded remote camera subscriptions, twenty remote audio subscriptions with received packets, native synthetic tab sharing received by all four peers with matching pixels, chat, camera/mic toggles, reconnection, cross-room permission rejection, host removal and the SFU returning to four participants. No uncaught browser errors occurred.
- The initial media run's final removal assertion failed and was preserved in `artifacts/qa/five-participant-initial-result.json`; the guest UI already showed that the host removed it. Added failure diagnostics and reran the full sequence; it passed without changing production moderation code. The first failure's exact cause remains unconfirmed, so it is retained as an intermittent test limitation rather than reported as a fixed product defect.
- Separate anonymous login/signup and actual sidebar navigation checks: **PASS** at 1440px and 390px, with external requests blocked and zero browser exceptions. Google-unavailable recovery remains readable; an in-page SDK fixture separately confirms the ready-provider icon layout. Real Google authentication was not tested. Evidence: `artifacts/qa/five-user-pages-browser.json`.
- Additional scheduling, guest OTP and SMTP reliability regressions: **51 passed, 0 failed**, covering OTP expiry/attempts/single use, scheduling and durable SMTP outcomes/duplicate prevention. Evidence: `artifacts/qa/five-user-scheduling-smtp-regression.tap`. Total automated unit/integration cases across these three runs: **96 passed, 0 failed**.

## Small frontend correction

Visual review of the anonymous mobile page found the Google provider error/retry message wrapping into a narrow 48px icon column when the external provider is blocked or unavailable. `frontend/src/styles/auth-entry-options.css` now places error/unconfigured provider recovery below the fields at full width. The ready-provider icon layout and all authentication behavior remain unchanged. The browser regression checks that recovery has at least 240px of readable width, renders login/signup at 1440px and 390px, and navigates through the actual workspace sidebar. A fresh production bundle is generated in `artifacts/qa/five-user-build`; the main application's build and runtime are not replaced.

Synthetic account/media fixtures are test-only injections in existing local harnesses. They were never applied to the public or main application. Test-owned temporary browser/server/SFU processes are closed after each run.

## Manual plan for five real testers

Use Tester 1 through Tester 5 as report aliases; map them privately to the existing allowlist without publishing the addresses. After public access is approved and healthy:

1. Tester 1 uses desktop Chrome as host. The other four use separate browser profiles/devices, including mobile and a different network. Each signs in to their own verified account. Complete any required email proof only after separate delivery approval; users enter their own codes.
2. Check login/signup layout on desktop and mobile. Open Overview, Bookings and Meetings through navigation. Confirm each sees only their own permitted data. A non-allowlisted identity must be rejected.
3. Host creates one test meeting with admission required. The four other accounts open that meeting and grant camera/microphone permissions. All four must remain waiting, with no media connection, until the host admits them individually. All five then see the same meeting and participant count.
4. Confirm each camera and microphone reaches all other users. Test mute/unmute and camera off/on. Use headphones to avoid feedback.
5. One desktop tester shares a non-private test window with a changing counter. Each of the other four confirms the shared content updates. Stop sharing and confirm all receivers return to the camera layout. Mobile reception is required; mobile screen-share initiation depends on browser/platform support and must be recorded separately.
6. Each user sends one distinct chat message. Disconnect one guest's network briefly, reconnect, and verify identity, permissions, media and chat recover. A guest must not end the meeting or control a different meeting. Host removes one guest; its media and rejoin authorization must be revoked. End the meeting for everyone.
7. Record browser/device/network and individual results, without recording email addresses, codes, invitation credentials or private media. Do not claim five external devices passed until this plan is actually executed.

## Preservation and SMTP reliability

No real email, OTP, reminder, host notification or Calendar invitation was sent during this task. No main or existing synthetic application data was changed. No credentials, allowlist entries or AI settings were changed. No paid resources were created.

The existing read-only SMTP audit (`scripts/audit-smtp-reliability-send.mjs`) checks the previous one-shot result, its consumed guard and persisted final acknowledgment, plus hashes of the original ambiguous guard and environment files. Its historical post-send link-validity field is not evidence that today's public origin is reachable. Do not reset either guard or retry either prior email.

The final SMTP preservation audit passed at 15:23:58 IST: the earlier accepted send remains exactly one attempt with recorded SMTP 250, both consumed guards and environment hashes remain preserved, zero retries occurred and normal delivery remains disabled. Evidence: `artifacts/qa/smtp-reliability-send-audit.json`. This was a read-only audit of the earlier send, not a new send.

## Reproduce local verification

Run from the project root; these commands use mocks or loopback services and do not launch a public tunnel:

```powershell
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs --test --test-concurrency=1 tests/tunnel-test.test.mjs tests/booking-link-test.test.mjs tests/meetings-server.test.mjs tests/meeting-management.test.mjs tests/confirmation-send-guard.test.mjs
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs --test tests/five-approved-auth.test.mjs
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs --test --test-concurrency=1 tests/guest-otp-test.test.mjs tests/scheduling-server.test.mjs tests/scheduling.test.mjs tests/smtp-delivery-reliability.test.mjs tests/smtp-reliability-one-shot.test.mjs
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs tests/five-participant-browser.mjs
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs node_modules/vite/bin/vite.js build --config frontend/vite.config.ts --outDir ../artifacts/qa/five-user-build
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs tests/five-user-pages-browser.mjs
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
node --no-warnings --import ./tests/helpers/cloud-egress-guard.mjs scripts/audit-smtp-reliability-send.mjs
```

The media script uses the existing `artifacts/qa/smtp-reliability-build` frontend fixture and the installed local LiveKit executable. It starts only random-port loopback services and closes them after testing. The later CSS correction affects provider error/unconfigured layout only and was checked in the fresh `five-user-build` bundle. The first build command invocation without the frontend config failed to locate the entry file; the corrected command above passed. No main build output was replaced.

## Files added for this verification

- `scripts/audit-five-user-public-readiness.mjs`
- `tests/five-approved-auth.test.mjs`
- `tests/five-participant-browser.mjs`
- `tests/five-user-pages-browser.mjs`
- `frontend/src/styles/auth-entry-options.css` (provider recovery layout only)
- This report, with evidence under `artifacts/qa/`.

No production backend, security or media source was changed for this testing task.

## Approval boundary

Public access is currently blocked. Separate approval is required to prepare/launch the scoped five-user public runtime, start or replace a temporary tunnel, and test the existing Cloud media project. Real email verification messages or invitations require their own recipient/count approval. No approval is inferred from passing local mock tests.
