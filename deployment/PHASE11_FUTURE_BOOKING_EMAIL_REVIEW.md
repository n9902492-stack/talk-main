# Future synthetic booking email review

Prepared 23 October 2026. Preview only: no Gmail message, OTP or SMTP authentication request was sent.

## Selected booking

- Meeting: Synthetic OrbitMeet booking link test.
- Host: Synthetic Booking Test Host.
- Guest: Synthetic Test Invitee.
- Date: Friday, 23 October 2026.
- Time: **2:15–2:45 PM IST (Asia/Kolkata)**; duration 30 minutes.
- Joining window: **2:00–3:45 PM IST**, with email proof and host admission still mandatory.
- Signed confirmation expiry: **3:45 PM IST**, one hour after the meeting ends. The existing policy already covers the meeting and joining window; no authorization or expiry policy was weakened.
- HTTPS origin: `https://latin-candle-answers-hampshire.trycloudflare.com`.
- Database: existing `data/booking-link-test/run-k4g1R9/talk.sqlite`. Exactly one new booking was added; the old booking remains intact. Main application and WebRTC-test databases were not used.

The refresh uses the existing availability and booking transaction engine. A private idempotency intent prevents a repeated refresh from inserting a duplicate. Prior manifests are retained. The fixture runtime permits retained synthetic history belonging to the same host/recipient while exposing only the currently selected booking/meeting ID. The old booking cannot be opened through the new public route scope.

The existing Cloudflare connector/controller and HTTPS origin were preserved. Only the idle port-3003 backend was reloaded after checking there were no active meeting connections. Its backend-only key, five-email allowlist, exact origin, secure cookies, CSRF/rate limits and disabled provider settings remain in effect. No env file was modified.

## One proposed message

Sender: `niknikhil.sharma22@gmail.com`.

Recipient: `niknikhil.sharma22@gmail.com`, verified against the unchanged five-email list and selected synthetic booking.

Subject: **Talk - Booking confirmed: Synthetic OrbitMeet booking link test**.

The existing branded Talk HTML/plaintext templates contain the meeting, named synthetic host/guest, date, time/timezone, 30-minute duration, private HTTPS confirmation action, ICS attachment instructions, email proof and host admission guidance. In this isolated preview, reschedule/cancel buttons are removed and replaced with:

> Rescheduling and cancellation are unavailable in this isolated test. Contact the host if you need changes.

This option defaults to the original behavior for all normal application emails. The full private body and bearer links are saved only in a Git-ignored directory with Windows ACL inheritance disabled and access granted only to the current Windows user:

`artifacts/qa/served-gmail-review-4WfkEc/served-preview-KM3GSb/`

Files include masked `preview.html`/`preview.txt`, complete `preview.private.html`/`preview.private.txt`, `message.private.json`, `talk-booking.ics`, and `final-review.json`. The private link is also refreshed in the isolated fixture's `invitation.private.txt`. No private joining credential is printed in reports or terminal output.

## Delivery safeguards and verification

- All standard host, invitee and reminder jobs remain cancelled across both synthetic bookings. No worker has a delivery transport.
- This review updates the existing durable first-confirmation scope for the exact new message. Consumed real attempts remain **zero**. The old preview no longer matches the current fingerprint.
- Any later authorized dispatch must reserve the single attempt durably before sending. Automatic retries/fallback are zero; failure or uncertain acceptance consumes the attempt.
- Gmail SMTP configuration passed offline validation; authentication and actual delivery remain **UNVERIFIED**. No SMTP network connection was made.
- Relevant booking-link, email, template and one-attempt security tests: **26 passed, 0 failed/skipped**. Tests use mock SMTP and block external egress.
- TypeScript/repository lint passed.
- Public browser verification of the new signed confirmation passed; its disabled guest-email notice is visible.
- Final future timing, exact ICS UTC start/end, signing/expiry, public valid/tampered links, old-route isolation and cancelled job checks are recorded in `artifacts/qa/future-booking-final-checks.json`.

## Remaining gates

This prepares **one invitee confirmation email only** after separate explicit approval. No host notification, reminder or OTP is authorized. The exact message, recipient, live origin, future meeting and unexpired link must be rechecked before sending.

Real guest joining is still blocked by disabled email proof delivery (`transport:null`); a separate approval and controlled verification-email path are required. Normal joining is also restricted to fifteen minutes before the appointment until one hour after its end. Gemini, other AI, SMS, recording/transcription and paid services remain disabled in the isolated runtime.
