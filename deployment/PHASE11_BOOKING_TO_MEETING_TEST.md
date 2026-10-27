# Phase 11 — isolated booking-to-meeting verification

Verified on 23 October 2026, using Asia/Kolkata for all user-facing times. This update used the user's explicit approval to replace only the idle port-3003 booking runtime's selected booking/meeting scope. No new tunnel, real email, OTP, paid service or deployment was started.

## New served booking

| Item | Result |
| --- | --- |
| Meeting | Synthetic OrbitMeet booking link test |
| Host / guest | Existing synthetic host / Synthetic Test Invitee |
| Recipient for a separately approved future OTP | niknikhil.sharma22@gmail.com |
| Appointment | **23 October 2026, 7:00–7:30 PM IST** |
| Joining window | **6:45–8:30 PM IST** |
| Signed-link/invitation expiry | **8:30 PM IST** |
| Public origin | https://latin-candle-answers-hampshire.trycloudflare.com |
| Listener | 127.0.0.1:3003 only |
| Database | data/booking-link-test/run-k4g1R9/talk.sqlite |

The existing availability/booking transaction engine selected a valid 30-minute slot more than two hours ahead. Exactly one new booking was added to the served database; its two prior bookings were preserved. A private durable intent makes repeated preparation idempotent. The existing signing secret was reused without changing any credentials. The current private joining link is in `data/booking-link-test/run-k4g1R9/invitation.private.txt`; its bearer credential is deliberately excluded from this report.

A consistent SQLite backup and previous scope/link are retained under `data/booking-link-test/run-k4g1R9/backups/booking-to-meeting-20261023/`. Do not restore over a running database. Any future rollback must verify the runtime is idle and preserve the current state first.

## Applied scope and preservation

Only the verified idle isolated backend was stopped and relaunched with its existing launcher, same database, existing five-email allowlist and exact HTTPS origin. The connector/controller process IDs and origin were preserved. The adapter's route allowlist still permits only the newly selected booking and meeting; old/foreign booking IDs and unrelated APIs remain unavailable.

The main localhost:3001 application was not stopped or modified. Neither environment file changed; final hashes match their pre-update baselines. LiveKit credentials, public frontend build, normal scheduling/email workers, recordings, transcripts, whiteboards and Gemini configuration were not modified. Disposable regression databases and a temporary loopback SFU were used for local tests and were not connected to the public tunnel.

All served-fixture notification jobs remain cancelled. The public runtime has no SMTP/verification transport. Final audit: zero OTP attempts, no OTP proof generated, invitation unredeemed, email/AI/SMS/recording disabled. The previously consumed Gmail confirmation ledger remains consumed at one; it was not reset or reused. No confirmation email was sent for this new booking.

## Validation

| Check | Final result |
| --- | --- |
| Booking, isolated-link, guest-security and email safeguard tests | **43 passed, 0 failed, 0 skipped** |
| Existing HTTPS health | 200; isolated runtime and disabled providers confirmed |
| New signed confirmation API and compiled HTTPS page | Passed; correct future 30-minute booking |
| Tampered and old-scope links | Rejected |
| Expired/revoked/version-changed links | Rejected in disposable mock regression fixtures; live invitation was not altered |
| Origin, missing form token and unauthenticated guest token | Rejected |
| Secure cookie isolation | Secure, HttpOnly, SameSite=Lax and bookingtest_ prefix verified |
| Unrelated API/private-file access | Rejected |
| OTP expiry / cooldown / attempt limit / consumption | Five-minute expiry, one-minute cooldown, five failed attempts and one-time redemption tested with a mock mailbox |
| Isolated browser flow using public adapter/build | Passed with in-memory OTP and genuine loopback LiveKit |

The media workflow used two separate authenticated browser contexts, the same restricted adapter and compiled frontend as the public runtime, a separate synthetic database, and a disposable local SFU. It verified:

- Signed confirmation to mock guest email proof to scoped pre-join.
- Microphone/camera permission and synthetic device capture.
- No guest media before admission; the host's actual participant panel showed the waiting guest and admitted them.
- Both browsers received audio RTP packets and decoded video frames.
- Microphone mute/unmute and camera off/on affected the real transported tracks.
- Synthetic browser-tab screen sharing and data-channel chat.
- Guest reconnection, unrelated-route denial, guest moderation denial and host removal terminating guest media.

The joining-window clock was adjusted only inside this disposable test fixture. The served 7:00 PM booking and its real joining window were not shifted. The first media-test run exposed a test assertion that incorrectly expected a mock OTP transport to equal a null transport; the final test checks that it has no outbox send method and dispatches zero notifications. No worker implementation changed. The final rerun passed.

Evidence:

- `artifacts/qa/phase11-e2e-security-tests.log`
- `artifacts/qa/phase11-booking-to-meeting-preparation.json`
- `artifacts/qa/phase11-booking-to-meeting-https-results.json`
- `artifacts/qa/phase11-booking-link-media.log`
- `artifacts/qa/phase11-booking-link-media-results.json`
- `artifacts/qa/phase11-booking-to-meeting-final-audit.json`

## Remaining live-test gates

The **public Gmail OTP and internet/LiveKit Cloud media flow remain untested**. The public adapter intentionally uses `transport:null`, and mock delivery is prohibited in public mode. Real OTP delivery needs a separately approved isolated, one-attempt delivery path; normal confirmations, reminders and host notifications must remain disabled. An OTP cannot be requested before the real joining window opens at **6:45 PM IST**.

Proposed later message: **one guest verification email**, recipient `niknikhil.sharma22@gmail.com`, subject **Your Talk verification code**, using the existing five-minute code template. No host notification, reminder, extra confirmation or retry is included. No live OTP has been generated or requested. The existing received Gmail confirmation concerns the previous booking; this new booking has not been emailed.

Live public audio/video cannot be marked passed from the loopback result. The public joining flow must be checked during its real window after separately approved email proof delivery. Physical devices and separate-network connectivity were not tested. Keep the current tunnel temporary; do not restart it without approval.
