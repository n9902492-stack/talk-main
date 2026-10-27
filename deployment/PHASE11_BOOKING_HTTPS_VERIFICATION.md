# Temporary isolated booking HTTPS verification

Verified 23 October 2026. This run was explicitly authorized for a temporary public test, not email sending or permanent deployment.

- HTTPS origin: `https://latin-candle-answers-hampshire.trycloudflare.com`
- Listener: `127.0.0.1:3003` only.
- Database: `data/booking-link-test/run-k4g1R9/talk.sqlite` only; one synthetic host and booking.
- Backend: isolated process 21460; connector controller 8692; cloudflared connector 13588 (PIDs are historical and must be rechecked before any later shutdown).
- Connector state: `data/booking-link-test/public-tunnel.json`, separate from the original WebRTC test state.
- Launcher: `scripts/start-booking-test-tunnel.mjs --approved`; raw connector output is never persisted. It checks the isolated server and database, refuses active meeting connections and forwards only to port 3003. Metrics bind `127.0.0.1:20243`.
- `SCHEDULING_PUBLIC_URL` is set only within the isolated backend process and matches its explicit `--origin`. Original `.env.local`, `.env.tunnel-test.local`, signing key, LiveKit credentials, main databases and other environments are unchanged.
- The old loopback-mode process was replaced only after confirming zero unexpired host/guest connections and its exact command line/listener owner. No other Talk process was stopped.

## Results

The local five-test security preflight passed, with zero failures/skips. The tunnel initially rejected public requests while the backend remained locked to its local origin; the exact public-origin backend was then started. No broad wildcard origin was enabled.

Actual requests through the public HTTPS origin verified:

| Check | Result |
| --- | --- |
| Isolated health | 200; email, AI, recording and SMS false |
| Confirmation page and correct signed detail | 200 |
| Invalid-format, tampered and foreign-booking credentials | Rejected, 403/404 |
| Correctly signed but expired booking | Rejected, 404 |
| Revoked invitation | Rejected, 404 |
| Restored synthetic booking | 200 |
| Guest verification request with SMTP disabled | 503, fails closed |
| Guest redemption without correct email proof | 403 |
| Guest token without a verified guest session | 401 |
| Secure cookie flags and isolated names | PASS: Secure, HttpOnly, SameSite=Lax and `bookingtest_` prefix |
| Missing form/CSRF token and wrong Origin | Rejected, 403 |
| Email outside the five-email allowlist | Rejected, 403 |
| Private env/data, unrelated APIs, recording and AI routes | Unavailable |

Expired/revoked checks temporarily changed only the synthetic occurrence/invitation, after confirming there were no active connections. Original times and revocation flags were restored in `finally` blocks and the valid link was retested successfully. No production or WebRTC-test records were modified.

The installed browser also loaded the actual public confirmation, rendered the signed synthetic booking and verified a secure context and the disabled-email notice. Browser requests to other origins were blocked. TypeScript/repository lint passed.

Evidence:

- `artifacts/qa/booking-link-https-preflight.tap`
- `artifacts/qa/booking-https-verification.json`
- `artifacts/qa/booking-https-browser.json`
- `artifacts/qa/booking-https-typescript.log`
- Sanitized connector/server logs under `artifacts/qa/booking-https-*`

No credentials or bearer links are printed in these reports. The complete synthetic invitation remains private in `data/booking-link-test/run-k4g1R9/invitation.private.txt` and now points to this HTTPS origin.

## Remaining gates

No Gmail email or OTP was sent. Normal SMTP delivery, SMS, recording/transcription, Gemini and other AI remain disabled. All normal scheduling notification jobs remain cancelled. The served fixture invitee matches the previously approved single email recipient, but no approval to send is inferred from this HTTPS test.

Before one real confirmation email, prepare and approve a fresh exact-message preview using this served fixture and this origin, verify its appointment/link remain unexpired and retain the durable single-attempt safeguards. The ordinary email smoke helper creates its own isolated database, so its newly created links must not be assumed to refer to this served fixture. Do not globally enable the outbox or change the original public URL merely to send one message.

Real guest joining is still blocked by email proof delivery. A separate authorization for the verification-email path is required before a real guest can complete it; do not bypass proof or expose mock codes. Local mock tests established waiting-room admission and moderation; this HTTPS run did not transmit real LiveKit audio/video.

This address lasts only while the laptop, isolated backend and Quick Tunnel remain running. A later tunnel restart may assign a new origin. To shut down, recheck the PIDs/command lines in the isolated state and stop only this connector/controller; do not use process-name-wide termination commands. Stop the isolated backend only when its meeting is idle. Keep the synthetic database for review.
