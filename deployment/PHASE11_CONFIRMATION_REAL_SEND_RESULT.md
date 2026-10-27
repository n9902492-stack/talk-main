# Phase 11 — one approved Gmail confirmation attempt

Completed **24 October 2026, 12:05:49 PM IST**.

- Booking: **Talk Booking Confirmation Test**, 24 October, **2:15–2:45 PM Asia/Kolkata**.
- Sender and recipient: **niknikhil.sharma22@gmail.com**.
- Subject: **Talk - Booking confirmed: Talk Booking Confirmation Test**.
- Exact reviewed HTML/plaintext and original ICS attachment fingerprint: **passed**.
- Upcoming meeting, isolated/local and public HTTPS health, five-email allowlist and private link authorization: **passed** before the attempt.
- Gmail SMTP authentication preflight: **PASS**.
- Actual `sendMail` invocations: **1**.
- SMTP acceptance: **UNCONFIRMED**. The dispatch did not return a verified successful acceptance result. No SMTP success code was recorded. This is not evidence of a confirmed Gmail rejection, and a delayed/accepted message cannot be ruled out.
- Durable authorization: **consumed**, status `failed_or_acceptance_unknown`; it cannot be replayed.
- Retries: **0**. No automatic or manual second send was attempted.
- Host emails, OTPs, reminders, SMS and Calendar writes: **0**.
- One-shot SMTP connection closed, process-local sending flag restored to false, isolated server delivery-disabled health confirmed, and `.env.local` unchanged.
- The main and isolated servers were not restarted or reconfigured. Booking records and the reviewed attachment were preserved. Only the separate attempt guard and sanitized result record were updated by the one-shot sender; normal HTTP verification used existing short-lived form challenges.

Raw sanitized result: `artifacts/qa/confirmation-approved-send-result.json`.

The sender and guard scripts were syntax checked. Three mock/local guard tests passed for a single reservation, changed-message rejection, restart protection and non-retryable authentication/ambiguous failures.

**Stop here. Check Gmail manually, including Spam, before considering any further send.** Inbox delivery is not confirmed, and this authorization has been consumed. Another message requires separate explicit approval.
