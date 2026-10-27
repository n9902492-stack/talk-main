# Phase 11 — approved isolated confirmation HTTPS test

Verified on 24 October 2026. **No real confirmation, host email, reminder, OTP, SMS or Calendar invitation was sent.**

## Running environment

- New temporary HTTPS origin: **https://bathroom-fully-rear-lucia.trycloudflare.com**
- Cloudflare connector: connected; actual public `/healthz` returned **200**.
- Isolated Node runtime: **127.0.0.1:3003**, loopback only. Listener address was asserted before starting Cloudflare.
- Database: `data/booking-link-test/confirmation-flow-vBfobG/talk.sqlite`.
- Exactly **one existing booking** was reused; no booking was recreated or duplicated.
- `SCHEDULING_PUBLIC_URL` is configured only in the isolated controller process. `.env.local`, `.env.tunnel-test.local` and the old tunnel's state file were preserved byte-for-byte.
- The main app continued returning **200** at `http://127.0.0.1:3001/`; it was not restarted or reconfigured.
- New runtime/tunnel status is in Git-ignored `data/booking-link-test/confirmation-public-tunnel.json`. It is separate from the previous public-test environment.

Booking: **Talk Booking Confirmation Test**, 24 October 2026, **2:15–2:45 PM Asia/Kolkata**, Synthetic Talk Host / Synthetic Test Invitee. Joining window **2:00–3:45 PM IST**; invitation expiry **3:45 PM IST**. Scheduled start/end were preserved throughout testing.

## Security and HTTPS results

- Existing five-email allowlist retained; approved recipient is included. Outsider login denied.
- Current backend-only signing secret validates the private booking/version-specific link through its scheduled expiry.
- The actual HTTPS confirmation page loaded the intended booking. Browser `isSecureContext` was true, and the private fragment was removed after local credential capture.
- Malformed, tampered and cross-booking links were rejected through HTTPS.
- Expired and revoked invitation rows were rejected through HTTPS. Only the idle synthetic invitation's expiry/revocation fields were temporarily changed and restored in `finally`; meeting time was never altered. The restored valid link was rechecked successfully.
- Guest email proof remains mandatory. Incorrect proof is rejected, unauthenticated guest joining is denied, and OTP delivery returns disabled. No proof was bypassed because host/guest share an email address.
- Host admission and request rate limits passed the local mock security suite; no live guest OTP/media admission was claimed for this run.
- HTTPS session cookies are **Secure, HttpOnly, SameSite=Lax**, with `bookingtest_` name isolation. Missing form challenge and untrusted origins were rejected.
- Other bookings, scheduling administration, Google sign-in, phone sending, Calendar, recordings and whiteboards are blocked by the isolated route whitelist.
- Only the selected booking confirmation/ICS, scoped guest join, selected host meeting/authentication and required static assets are available. Normal booking creation and dashboard routes are not publicly exposed.
- The synthetic host can log in using a newly prepared password identity in this fixture only. Private host access stays in `host-access.private.json`; no real account password was used or changed. The account and booking counts remain one.
- SMTP/OTP, SMS, recording, transcription, Gemini and Calendar adapters remain disabled. LiveKit configuration was read without changing credentials or making a media room.

The initial default launch was blocked by sandbox network permissions. The approved network-enabled runtime also required read access to the protected fixture; access was restricted to the local user and sandbox identity, without granting broad/public filesystem access. A UTF-16 test-log parsing issue was corrected. No usable public origin or booking route was accepted during these failed launch attempts. The final controller rejects tunnel Host headers until its new origin is configured; initialization errors close ingress.

## ICS

The actual browser **Add to calendar** action downloaded an ICS over HTTPS. Its `DTSTART` is **20261024T084500Z**, and `DTEND` is **20261024T091500Z**, exactly matching 2:15–2:45 PM IST. The attachment contains no private bearer credential or localhost link. No Google Calendar API call or invitation was made.

## Updated invitee email preview

Sender: **niknikhil.sharma22@gmail.com**  
Recipient: **niknikhil.sharma22@gmail.com**  
Subject: **Talk - Booking confirmed: Talk Booking Confirmation Test**

```text
Hi Synthetic Test Invitee,

Your meeting with Synthetic Talk Host is confirmed.

Meeting: Talk Booking Confirmation Test
Duration: 30 minutes
Invitee time: Saturday, October 24, 2026 at 2:15 PM - Saturday, October 24, 2026 at 2:45 PM (Asia/Kolkata)
Host time: Saturday, October 24, 2026 at 2:15 PM - Saturday, October 24, 2026 at 2:45 PM (Asia/Kolkata)
Host: Synthetic Talk Host

View booking and join:
https://bathroom-fully-rear-lucia.trycloudflare.com/booking-confirmation?id=[BOOKING_ID]#[PRIVATE_CREDENTIAL]

Add to calendar: Open the attached talk-booking.ics file in your calendar app
to add or update this meeting.

Rescheduling and cancellation are unavailable in this isolated test.
Contact the host if you need changes.

Keep this private booking link to yourself. Talk will verify your email before
guest access; the host may need to admit you from the waiting room.

Talk
```

The existing branded HTML/plaintext template was reused. Exactly one invitee message is prepared. Full unmasked content is kept in the protected, Git-ignored fixture directory:

- `confirmation.https.private.html`
- `confirmation.https.private.txt`
- `confirmation.https.private.json`
- `invitation.private.txt`
- `talk-booking-https.ics`
- `confirmation-send-guard.sqlite`

The new booking-specific guard is **unconsumed / awaiting_approval**, bound to the message/attachment fingerprint. Previous consumed attempt guards were not reset. The standard isolated outbox retains one queued invitee confirmation with **zero attempts**; every host/reminder job is cancelled. Its SMTP transport is null. This preparation does not enable a send command, an SMTP worker or automatic retries.

Gmail SMTP settings pass offline validation; sender/SMTP user match the approved address. **Live SMTP authentication was not retested, and delivery has not been attempted.** A later authorized send still needs a fresh health/time/signature/guard preflight. Guest OTP needs separate approval and remains unavailable in this environment.

## Tests, code and evidence

- **23 focused tests passed, 0 failed**: isolated fixture/link/guest/host-admission/rate-limit/origin/cookie/security tests, scheduling HTTP regressions and SMTP-link transport tests. SMTP/OTP use mocks only.
- **11 HTTPS verification groups passed**, including the actual browser page and download, synthetic host login, rejected invitations, private-route isolation, cookie/CSRF/origin checks and unchanged main-app availability.
- Node syntax checks passed for controller, verifier and isolated runtime module.
- Evidence: `artifacts/qa/confirmation-https-security.tap`, `confirmation-https-results.json`, `confirmation-https-page.png`, sanitized controller logs.

Targeted changes: `backend/src/scheduling/booking-link-test.mjs` recognizes the separately marked one-booking confirmation fixture with strict title/account/job checks; existing older test-fixture rules remain. `tests/booking-link-test.test.mjs` adds coverage for this fixture. New scripts: `scripts/start-confirmation-test-tunnel.mjs`, `scripts/verify-confirmation-test-https.mjs`.

Source checkpoint: `artifacts/backups/confirmation-https-*`. No main authentication, frontend, LiveKit, Calendar, SMTP, recording, analytics or whiteboard code was replaced.

This is a temporary local controller and Quick Tunnel, not a deployment or installed service. The tunnel origin can stop working when its process/network ends. No email may be sent without the user's next separate explicit authorization; this approval covered HTTPS preparation only.
