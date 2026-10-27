# Five-user real public meeting test

24 October 2026, Asia/Kolkata. Preparation and manual testing in progress. **No real verification emails or OTPs have been sent. No running service was restarted.**

## Current services and meeting

- Sign-in: https://unfortunately-directory-clearing-yorkshire.trycloudflare.com/sign-in
- Meeting: https://unfortunately-directory-clearing-yorkshire.trycloudflare.com/device-test?room=m-3add04ea-20ab-48c1-a6bc-e62f5fc251b3
- Last host-login preflight: **16:11:14 IST**, HTTPS health **200**, sign-in **200**, meeting **active**, owner **verified**, SMTP **disabled**.
- Isolated listener: `127.0.0.1:3003`; database: `data/five-user-public-test/run-Ofjpbs/talk.sqlite`.
- Existing server PID 24540 and cloudflared PID 25668 remain unchanged. The five-email allowlist contains five distinct addresses and is unchanged.
- Main application, existing databases/bookings, LiveKit credentials, Calendar, recordings/transcription, whiteboards, Analytics, environment files and prior SMTP guards are untouched.

The shared test meeting is immediately joinable by verified accounts and does not use the separate future synthetic booking's joining window. It has not ended and still requires host admission. Preparation does not create an SFU media room or issue a token to a real user.

## Three verified identities

**Host correction from the user:** the intended host is `niknikhil.sharma22@gmail.com`. Read-only inspection confirms this account and password identity are verified in the isolated database. It does not own the precreated fixture meeting. Do not transfer ownership or bypass authorization: create a new meeting through that account's existing authenticated UI and use its new shared meeting URL. The fixture meeting and all bookings remain unchanged. The host-login result is recorded below.

**Manual progress:** the user confirmed “host dashboard visible.” A subsequent read-only check found one active, confirmed session for the intended host in the isolated database. **Host login: PASS (user observation plus backend session evidence).** Other logins, new meeting ownership and real media remain untested. Next: Guest 1 login in Chrome Incognito using a different existing verified test account.

**Guest 1 progress:** the user confirmed “guest 1 dashboard visible.” The isolated database shows one active confirmed session for Guest 1 and one for the host, attached to distinct verified account IDs. **Guest 1 login and host/Guest 1 identity separation: PASS (user observations plus backend evidence).** Guest 2 has not signed in yet. No meeting/media result is marked passed.

Three existing approved password identities are verified and eligible for normal login with their existing **Talk test passwords**. Passwords have not been read, reset or generated. The host is the existing meeting owner; its mapping is in the protected local `host-account.private.json` beside the database. Other verified users must remain guests in that meeting until the host admits them.

The initial readiness snapshot found **zero active login sessions for these three identities**. Host login has since been confirmed as recorded above; the two guest logins and real media remain unverified. Automated local tests prove separate sessions, namespaced Secure/HttpOnly/SameSite cookies, CSRF protection, host/member authorization, opaque single-use token generation and admission gating. Those results are not a substitute for the user's manual sign-in confirmation.

## Two pending users and email preparation

Both pending addresses are in the approved allowlist, but neither has an account/password identity in the current isolated database. They were not failed email deliveries or expired verification challenges: they have not completed signup here. Both are eligible for normal signup. At inspection, each had zero active verification challenges, zero cooldown and no active per-email signup/delivery rate bucket.

Exact recipients are listed in this protected Git-ignored preview, rather than committing private addresses to this report:

[Two-recipient email preview](../data/five-user-public-test/run-Ofjpbs/account-verification-preview.private.json)

| Proposal | Value |
| --- | --- |
| Sender | Existing configured Gmail sender, recorded in the private preview |
| Recipients | Pending tester 1 and pending tester 2, exact addresses in preview |
| Message type | Normal Talk signup email verification |
| Subject | `Your Talk verification code` |
| Maximum real emails | **2 total: one to each pending address** |
| Retry policy | No automatic retry; any failed or ambiguous attempt remains consumed |
| Current activation | **OFF**; not installed in running process |
| SMTP connections / OTPs generated during preparation | **0 / 0** |

The existing Gmail adapter supports SMTP port 587 with required STARTTLS, certificate validation, TLS 1.2 minimum and disabled protocol/body logging. Configuration checks passed. SMTP authentication was not performed in this preparation; historical Gmail delivery does not establish a new send result.

A dormant wrapper reuses that adapter and the unchanged normal signup/verification endpoints. It binds delivery to this runtime, its origin/database, SMTP configuration and only the two reviewed recipients. Separate durable guards permit one attempt per recipient with unique Message-IDs. Reservation is persisted before SMTP. It checks that the generated code matches the pending signup's salted hash and expires within five minutes. No plaintext OTP is logged, returned in APIs or saved in reports. Missing final SMTP 250 is not labeled accepted. A failed/uncertain attempt cannot retry after adapter restart.

Offline proposal and unused guards are prepared beside the database. This does **not** enable delivery in the active server. Before any future activation, obtain explicit approval for both exact recipients and two maximum messages; then coordinate an idle isolated-server update to install the scoped adapter while preserving the existing tunnel and sessions. Do not interrupt an active meeting. General SMTP, booking confirmations, reminders, host notifications, booking-guest OTP, SMS, recording/transcription, Gemini and live Calendar remain disabled.

Each pending tester must enter their own name and chosen password in signup, receive the separately approved email and enter their own code in the same browser on Talk. Do not ask for, read or submit their real OTPs. Verification remains mandatory; no account is pre-verified. After both guarded attempts are consumed, sending is disabled but valid pending codes can still be entered through the normal verification endpoint.

### Normal limits

- Verification code: **5-minute expiry**, single-use; **5 incorrect attempts**.
- Resend cooldown: **60 seconds**. The controlled proposal is stricter: only one send per recipient, so a resend needs separate approval even after cooldown.
- Signup: **10 per email / 40 per IP per hour**.
- Email delivery: **5 per email / 30 per IP per hour**.
- Verify submissions: **20 per email / 50 per IP per 10 minutes**.
- Password login: **10 per email / 40 per IP per 15 minutes**.
- Current pending-recipient cooldown: **0 seconds**, subject to rechecking immediately before activation.

## LiveKit and browser readiness

Authenticated read-only LiveKit Cloud requests passed for **this meeting only**. At the snapshot, no SFU room existed, connected participants were **0**, and published camera/microphone/screen tracks were **0**. No room or media token was created by the inspection. Actual media connectivity remains **NOT TESTED**.

The existing signaling gateway is configured for the current HTTPS origin, with exact WebSocket origin checks and opaque tickets backed by the isolated database. Local regressions cover token issuance only after admission, host/member permissions and revoked rejoining. HTTPS page access and an authenticated API request do not prove WebRTC media reception.

Public browser automation passed using **Chrome 155.0.8059.85**, local Windows headless automation, at 1440px and 390px. It used no real accounts and requested no hardware media. The browser reported a secure context, camera/microphone and screen-capture APIs available, and camera/microphone/display-capture policies allowed. Camera and microphone permissions were **prompt**, not granted. Device permissions and actual capture must be checked on each real device.

## User-proposed real setup

| Alias | Device / browser | Network | Observation status |
| --- | --- | --- | --- |
| H | User's Windows laptop, Chrome normal profile | Wi-Fi | Dashboard confirmed by user; isolated host session present |
| G1 | Same Windows laptop, Chrome Incognito (user-proposed setup) | Same Wi-Fi | Dashboard confirmed by user; separate account session present |
| G2 | Mobile phone or second laptop, Chrome | Mobile data or separate Wi-Fi | Proposed; exact device/network not yet confirmed |
| G3 | Pending tester 1, device/browser to be supplied | To be supplied | Account verification pending |
| G4 | Pending tester 2, device/browser to be supplied | To be supplied | Account verification pending |

H and G1 share hardware/network and do not count as two external devices/networks. Record exact browser/OS/device versions and the actual G2 network before drawing interoperability conclusions.

## Manual checklist — mark only after observation

`—` means **NOT TESTED**, not PASS. Replace each applicable cell with PASS or FAIL and record the observed error/time. User-entered passwords/codes must never be included.

| Actual check | H | G1 | G2 | G3 | G4 |
| --- | --- | --- | --- | --- | --- |
| Correct account signs in and reaches Overview | PASS | PASS | — | — | — |
| Independent identity/session; no account crossover | PASS | PASS | — | — | — |
| Opens the same meeting/title | — | — | — | — | — |
| Camera/mic permission granted and pre-join preview works | — | — | — | — | — |
| Waits without meeting media until admitted | N/A | — | — | — | — |
| Host sees and admits the correct identity | — | — | — | — | — |
| Publishes camera and microphone | — | — | — | — | — |
| Receives every other participant's moving video and speech | — | — | — | — | — |
| Host screen share is sent / decoded with moving content | — | — | — | — | — |
| Unique chat messages synchronize across all participants | — | — | — | — | — |
| Camera off/on and mic mute/unmute affect remote reception | — | — | — | — | — |
| Guest reconnects with same identity and restored media | N/A | — | — | — | — |
| Host removes selected guest; guest disconnects | — | — | — | — | — |
| Removed guest cannot rejoin without host reauthorization | N/A | — | — | — | — |

### Guided sequence

1. **Host login first.** In normal Chrome open the sign-in URL. Use the current meeting owner's existing Talk test account/password. Do not use a Gmail password or request any verification email. Confirm Overview appears before marking PASS or continuing.
2. Guest 1 signs in with a different verified account in Chrome Incognito. Guest 2 signs in with the third verified account on the agreed second device/network. Confirm each independently.
3. Host opens the meeting URL, checks devices and joins. Each guest opens exactly the same meeting URL, checks devices and joins the waiting room. Host should see both requests. Guests must receive no meeting media before admission.
4. Host admits each named guest through People. Confirm count three and each remote camera/audio reception separately. Use headphones on the laptop sessions to avoid feedback; same-laptop microphone/camera sharing may be constrained by the OS/browser and must be recorded if it fails.
5. Host shares a non-private test window with changing content. Both guests confirm live updates, then stop sharing. Send distinct chat messages, toggle camera/microphone and reconnect one guest after a brief network interruption. Record actual results, not expected behavior.
6. Repeat with four guests only after both pending users normally verify their accounts. Test all four screen-share receivers and removal/rejoin blocking. Do not relabel the earlier local synthetic five-browser result as this real public test.

## Evidence and test status

- Existing public HTTPS/security recheck: **PASS**, no sends or process restarts.
- LiveKit authenticated scoped presence/API check: **PASS**; real external media and screen sharing: **NOT TESTED**.
- Public desktop/mobile browser rendering and permission API checks: **PASS**, zero page errors; no real users authenticated by automation.
- New controlled-verification tests: **3 passed, 0 failed** after correcting a test expectation for the existing 403 replay/CSRF rejection. Tests use mocked SMTP only and normal signup/code consumption, including sending-disabled verification and ambiguous-failure guard persistence.
- Broader email/auth/adapter regression rerun: **36 passed, 0 failed**, mocked SMTP only. The three new cases above are included in this count. Earlier 100-test public-runtime suite remains historical evidence.
- Prior SMTP preservation audit: **PASS** at 16:13:38 IST; original guards/environment unchanged and no new attempt or retry. This audits the earlier accepted send, not a new email.

Evidence files: `artifacts/qa/five-user-real-readiness.json`, `five-user-real-cloud-presence.json`, `five-user-public-browser.json`, `five-user-verification-only.tap`, `five-user-real-verification-tests.tap`. Private exact-recipient proposal and unused guards remain beside the isolated database.

Real observation tracker: `artifacts/qa/five-user-real-observations.json`. Current manual phase: **Step 3 — waiting for Guest 2 login confirmation and exact device/network details**. Host and Guest 1 logins are PASS; Guest 2 and all real media remain untested.

## Remaining blockers and approval

1. Host and Guest 1 logins are confirmed. Guest 2 must still sign in and identify the actual device/network; media testing has not begun.
2. Two additional users have not signed up/verified in this database.
3. To verify them, separately approve **exactly one normal signup verification email to each of the two exact addresses in the private preview (two total)**, from the preview's Gmail sender, subject `Your Talk verification code`, with no other messages, no automatic retries and no guard reset. Both testers should be ready to enter codes within five minutes.
4. Scoped mail activation requires an idle isolated-runtime update; it has not been performed and the live server still has no mail adapter. Preserve the tunnel and do not interrupt a meeting.
5. Real external-device audio/video, screen reception, chat and reconnection remain unobserved. No paid resource, billing, email, OTP, deployment or unrelated public route change is authorized by this preparation.
