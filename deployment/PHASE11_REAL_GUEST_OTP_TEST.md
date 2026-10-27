# Phase 11 - one authorized real guest OTP

23 October 2026. The existing 7:00-7:30 PM IST synthetic booking and 6:45-8:30 PM joining window were preserved.

- Fresh time, HTTPS, invitation, five-email allowlist, idle isolated server, secure cookie/origin/CSRF, disabled-provider and SMTP preflight checks passed.
- Gmail SMTP authentication passed without sending during preflight.
- Thirteen focused security/API tests passed. A separate mock browser check verified code redemption after delivery was disabled and the page reloaded.
- Only the idle isolated server on 127.0.0.1:3003 was reloaded. Main Talk on 3001, original environment files and the existing tunnel were preserved.
- An isolated build-only correction keeps the code-entry form available after sending is disabled. Main frontend source and production output were not changed for this correction.
- Exactly **one** real email dispatch attempt was consumed through the normal guest challenge endpoint; HTTP 200 and Gmail SMTP acceptance were recorded. No retry occurred.
- Sender and recipient: niknikhil.sharma22@gmail.com. Subject: Your Talk verification code.
- The sender disarmed immediately on durable reservation. Post-send health confirmed controlled guest delivery and normal delivery disabled, all jobs cancelled, and AI/SMS/recording disabled. Transcription remains unavailable in this runtime.
- The signed confirmation was opened in a guest incognito window for manual entry. No mailbox or plaintext OTP was read, and no live OTP was submitted by the agent.
- Inbox receipt, manual verification, public waiting room, host admission and internet media remain pending user interaction. Earlier local media tests do not establish these live outcomes.

Sanitized evidence: `artifacts/qa/phase11-real-guest-otp-result.json`, `artifacts/qa/phase11-real-guest-otp-after-send.json`, and `artifacts/qa/phase11-live-otp-smtp-preflight.json`. The durable guard and operator request reservation remain consumed and must never be reset to retry this authorization.
