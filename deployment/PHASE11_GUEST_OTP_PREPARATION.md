# Phase 11 - controlled guest Gmail OTP preparation

Prepared and verified on **23 October 2026, approximately 5:04 PM IST**. This task authorized preparation and offline testing only. **Zero real emails, zero public OTP requests and zero SMTP connections were made.** No service or tunnel was restarted.

## Current environment and booking

| Item | Verified result |
| --- | --- |
| Existing HTTPS origin | https://latin-candle-answers-hampshire.trycloudflare.com |
| Tunnel | Public HTTPS health passed; existing connector/controller IDs unchanged; local readiness endpoint returned 200 |
| Isolated listener | 127.0.0.1:3003, existing PID 29452 |
| Main application | localhost:3001 returned 200; not restarted or modified |
| Isolated database | data/booking-link-test/run-k4g1R9/talk.sqlite |
| Appointment | Synthetic OrbitMeet booking link test, 23 October 2026, **7:00-7:30 PM Asia/Kolkata (IST)** |
| Guest joining window | **6:45-8:30 PM IST** |
| Signed invitation expiry | **8:30 PM IST**; correct booking, current signing secret, unrevoked and unredeemed |
| Synthetic guest | Synthetic Test Invitee, niknikhil.sharma22@gmail.com |
| Host | Synthetic Booking Test Host; current private password login and authorized meeting state succeeded over HTTPS; temporary login session logged out |
| Email/notifications | Running server still has no delivery transport; all isolated scheduling jobs cancelled |
| Other services | SMS, recording, transcription, Gemini and other AI integrations remain unavailable in the isolated adapter |

No booking was created or rescheduled. The database still contains its existing three synthetic bookings and one account. The five-email allowlist, original environment files, signing secret, LiveKit configuration and original confirmation-email attempt ledger were preserved. The real invitation has no OTP proof, no verification attempts and no guest redemption.

## Proposed one-message envelope

- Sender: **niknikhil.sharma22@gmail.com** (Talk).
- Recipient: **niknikhil.sharma22@gmail.com**.
- Subject: **Your Talk verification code**.
- Message type: **guest email verification**, using the existing branded HTML and plain-text Talk verification template.
- Body: a newly generated six-digit code, five-minute expiry with the exact IST expiry time, single-use and privacy instructions. No actual code was generated for the served invitation during preparation.
- Quantity after separate approval: **one invitee verification email, maximum one dispatch attempt**. No confirmation, host notification, reminder, SMS or extra OTP.

Sender and recipient being identical never counts as email verification. The guest must enter the delivered code and still needs host admission.

## Implementation

`backend/src/scheduling/guest-otp-test.mjs` implements an isolated-only, opt-in transport. Preparation checks the marked synthetic database, account, booking title/guest/email, booking version, invitation, active meeting with host admission required, current signed URL, five-email allowlist, exact HTTPS origin and existing Gmail configuration. It stores an immutable private policy and a separate durable SQLite attempt ledger inside the existing fixture directory. Both are Git-ignored. No OTP or SMTP password is stored in that ledger or policy.

At send time the adapter rechecks that binding, invitation status and joining window. It accepts only the code whose hash and exact five-minute expiry were persisted by the existing guest verification service. An atomic ledger update commits `consumed=1` **before any SMTP operation**. Success, failure, ambiguous results and crashes cannot automatically reopen the attempt; concurrent requests and restarts cannot resend it. Failed/ambiguous delivery also invalidates the stored proof. There is no reset command.

The adapter reuses `createVerificationMailer` and the verified Gmail SMTP configuration: port 587, mandatory STARTTLS, certificate validation, TLS 1.2 minimum, logging disabled, one recipient, no pooling and `maxRequeues=0`. There is one `sendMail` call at most, no verification probe and no SMTP retry path. Only fixed, sanitized errors are exposed. This adapter has no general scheduling-outbox `send` method.

`backend/src/scheduling/guests.mjs` now passes booking/invitation context and checks an optional transport precondition before changing the proof. This prevents a blocked resend from overwriting a still-valid first code. It also uses one shared expiry value for persistence and delivery. Existing normal mock transports remain compatible. Cryptographic generation (`crypto.randomInt`), one-minute cooldown, five incorrect attempts, five-minute expiry, one-time redemption and scoped guest cookies remain enforced.

`backend/src/scheduling/booking-link-test.mjs` accepts only a branded, controlled adapter for this opt-in path. SMTP remains disabled by default, public mock mailbox injection remains rejected, exact route scopes and origin/cookie protections stay in place. Normal account email delivery stays disabled. The health response distinguishes normal email from the optional controlled guest adapter.

`scripts/prepare-booking-guest-otp.mjs` performs offline preparation only. `scripts/booking-link-test.mjs` contains a future `--approved-one-guest-otp` activation option, valid only for an explicitly approved isolated start with the prepared binding. **That option was not invoked. The running public process remains unchanged and has no live OTP delivery capability.**

## Verification results

| Final verification | Result |
| --- | --- |
| Guest OTP guard, isolated routes, scheduling, email safeguards and verification mailer tests | **61 passed, 0 failed** |
| Google authentication/confirmation, email authentication, Firebase phone mocks and password reset regressions | **61 passed, 0 failed** |
| Actual HTTPS confirmation, signing, host login, origin/form-token checks and route isolation | **8 groups passed** |
| Two-browser isolated workflow using mock email and real loopback LiveKit | **5 groups passed** |
| Real OTP attempts consumed | **0** |
| Public OTP proof or redemption created | **None** |
| SMTP authentication in this task | Not attempted; offline configuration ready; earlier authorized Gmail confirmation authentication/delivery was already verified |

The **122 final unit/API regression tests passed** with external network access blocked. All SMTP tests inject mock transports. Cases cover expiry, wrong-code limits, cooldown, single use, recipient/booking/invitation binding, allowlist changes, revoked/cancelled/ended meetings, mismatched signing/SMTP configuration, CSRF/origin protections, no pre-verification guest token, no self-admission, duplicate/concurrent sending, consumed-guard persistence and crash recovery. A blocked resend preserves the working proof.

The browser test used a separate disposable synthetic database and local SFU. It verified actual host-panel admission, received audio packets and video frames, mute/unmute, camera off/on, synthetic tab sharing, chat, scoped cookie reconnection, meeting isolation and removal. **Public internet/LiveKit Cloud media and live Gmail OTP delivery were not tested.**

An initial new test had its clock inside an already-open fixture joining window; its clock was corrected. An initial parallel authentication run had one loopback `fetch failed` in a password-reset test; the serial rerun passed all 61 without changing authentication code. Final logs above contain no failures.

Evidence:

- artifacts/qa/phase11-guest-otp-preparation.json
- artifacts/qa/phase11-guest-otp-tests-final.log
- artifacts/qa/phase11-guest-otp-auth-tests-final.log
- artifacts/qa/phase11-guest-otp-https-results.json
- artifacts/qa/phase11-guest-otp-media.log
- artifacts/qa/phase11-booking-link-media-results.json

## Remaining gates before the one real OTP

1. Obtain the user's **separate explicit approval to send exactly one guest verification email** to the envelope above. This preparation is not that approval.
2. Activate the new scoped adapter only on the **idle isolated server**; this requires a controlled reload of that server with the explicit option. Do not reload the main application or replace the tunnel. Verify idle connections before any reload; stop if meetings are active or broader access would be needed.
3. Recheck live HTTPS health, unchanged origin/allowlist/configuration, current private invitation, all cancelled jobs and **zero** consumed OTP attempts. Keep general SMTP, reminders and other integrations disabled.
4. After **6:45 PM IST**, the guest can request its one code through the signed confirmation page. The adapter refuses sends outside the joining window or after the attempt is consumed. An OTP is valid for **five minutes**, not for the entire joining window; the recipient must enter it promptly. Do not automatically retry failure or ambiguity.
5. After email proof, verify pre-join, waiting room and host admission. Internet media remains a separate live verification step. Return the isolated process to its default email-disabled launch after the controlled attempt when safe, preserving guest sessions and the durable ledger.

**Conditional readiness:** one OTP can be tested after 6:45 PM IST and before the joining window closes, only after explicit approval, scoped activation and a fresh successful preflight. Currently real sending remains blocked intentionally. No private joining credential, OTP, host password or SMTP credential is included in this report.
