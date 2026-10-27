# Phase 11 — one authorized real Gmail SMTP reliability test

24 October 2026, Asia/Kolkata. **Exactly one real invitee confirmation SMTP attempt was made. Gmail returned a final message acceptance code of 250. The durable outcome is `CONFIRMED_ACCEPTED`. Inbox delivery still requires the user's manual confirmation.**

## Result

| Requested check | Actual result |
| --- | --- |
| Real send attempts | **1** |
| SMTP connection | Established |
| TLS | STARTTLS completed, certificate validation required, TLS minimum 1.2 |
| Authentication | **PASS**, observed response **235** on the message's own connection |
| Submission | MAIL/DATA observed |
| DATA completion | Local stream completion observed; final server acknowledgment subsequently observed |
| Final message acceptance code | **250** |
| Delivery-attempt outcome | **CONFIRMED_ACCEPTED** |
| Sanitized error category | None |
| New durable guard | **Consumed**, terminal `smtp_accepted` |
| Retry count | **0** |
| General SMTP afterward | **Disabled**, confirmed by isolated HTTPS health |
| Current HTTPS link afterward | **Valid and reachable**, confirmed after the attempt |
| Host / reminder / OTP emails | **0 / 0 / 0** |
| External Calendar writes / separate invitations | **0** |

Sender: **niknikhil.sharma22@gmail.com**  
Recipient: **niknikhil.sharma22@gmail.com**  
Subject: **Talk - Booking confirmed: SMTP Reliability Test**

Preserved Message-ID: `<d25c45a7-dd32-4af6-85d4-6bd6f3d2472e@talk.local>`.

Durable delivery-attempt ID: `efd723a2-69b7-4143-86bf-b0b7ef42aeed`.

## Fresh preflight

Initial actual-time check: **1:28 PM IST**. Final fresh preflight completed at **1:36:49 PM IST**, before the scheduled **3:45–4:15 PM** booking.

Preflight verified:

- The existing independent server on `127.0.0.1:3003` and Cloudflare connector were running; no new booking, runtime restart or tunnel was created for this send.
- Existing HTTPS origin: `https://knights-downloaded-phil-copyright.trycloudflare.com`.
- The exact existing synthetic database under `data/smtp-reliability-test/run-9MbE1g/talk.sqlite` and correct confirmed booking ID `6ecc6490-aec8-4f19-8ffd-ffe7e5b82870`.
- The reviewed private HTML/plain text, original ICS bytes, intended sender/recipient, Message-ID and guard fingerprint matched exactly.
- The signed invitation was valid, associated with this booking, and not expired. The live HTTPS detail and calendar endpoints returned the intended booking and correct timestamps.
- The five-email allowlist remained intact and contained the approved recipient.
- Gmail SMTP credentials were available without logging them; sender/user matched the approved address. SMTP host was `smtp.gmail.com`, port 587, mandatory STARTTLS, certificate verification enabled, TLS minimum 1.2, no opportunistic/insecure fallback, no pooling/requeue and no raw debug output.
- The new guard was unused, with zero prior outbox attempts. The original ambiguous-send guard and result matched preservation hashes.
- All **18 mock safeguard tests passed**, including acknowledgment loss, missing acceptance evidence, authentication failure, post-acceptance exceptions and duplicate guard prevention.

No separate `smtp.verify()` connection was made. TLS and authentication evidence came from the actual single message connection, avoiding the previous ambiguity between a successful preflight connection and an unobserved dispatch connection.

## Recorded SMTP timeline

Times below are 24 October, IST, taken from persisted diagnostic events:

| Phase | Time / evidence |
| --- | --- |
| Connection initiated | 1:36:50.266 PM |
| Connection established | 1:36:53.144 PM, SMTP greeting 220 |
| STARTTLS requested | 1:36:53.875 PM |
| TLS completed | 1:36:55.580 PM |
| Authentication started | 1:36:56.545 PM |
| Authentication succeeded | 1:36:57.488 PM, response 235 |
| Submission / DATA command | 1:36:57.507 PM |
| Server ready for DATA | 1:36:58.543 PM, response 354 |
| Local DATA stream completed | 1:36:58.547 PM |
| **Final server message acknowledgment** | **1:37:00.204 PM, response 250** |
| Post-send health/report completion | 1:37:03.578 PM |

The final 250 was observed through SMTP transaction instrumentation and persisted before marking the job sent. It was not inferred from an HTTP 200, a recipient envelope acknowledgment or an accepted-recipient array alone. The protocol reply queue distinguishes MAIL/RCPT replies from the final DATA acknowledgment. Provider free text, passwords, private URLs, OTPs and body contents were not persisted in diagnostics.

## Durable guard and outbox evidence

The existing new guard file is:

`data/smtp-reliability-test/run-9MbE1g/send-attempt-guard.sqlite`.

Its reservation committed **before** starting SMTP. A booking-scoped `controlled_smtp_dispatch` record durably limits the transport invocation counter to 0 or 1. Its actual `send_calls` is **1**, with outcome `CONFIRMED_ACCEPTED` and the preserved Message-ID. This table was added only to the new synthetic guard database, not to any main database.

In the synthetic application database:

- `scheduling_email_attempts` contains exactly one attempt with the above ID, attempt number 1, Message-ID, timestamps, final code 250, terminal `CONFIRMED_ACCEPTED` and sanitized phase events.
- The intended `confirmation:invitee` outbox job is `sent`, attempts **1**, delivery outcome `CONFIRMED_ACCEPTED`.
- Host/reminder jobs remain cancelled. No worker was enabled.
- The new one-shot guard is consumed and must not be reset or reused.

The original ambiguous attempt remains `failed_or_acceptance_unknown`, consumed, unchanged and un-retried. Its record was not used for this send. A read-only post-send audit validated both guards, the outbox/attempt records, actual dispatch count and preserved file hashes.

## Safe-state restoration and preservation

The narrowly scoped SMTP adapter existed only in the one-shot process. The running isolated server remained SMTP-disabled throughout. Immediately after the attempt, the one-shot transport was closed and its in-memory scheduling-email flag was set back to false. No `.env` file was changed. The script exited with code **0**.

Post-send HTTPS health confirmed email, guest OTP, AI, SMS and recording disabled. Existing isolated configuration also keeps transcription and live Calendar operations disabled. No real OTP, reminder, host notification or external calendar request was made. The one invitee email included only the reviewed ICS attachment as authorized.

The main application, databases, original public-test configuration, LiveKit, Google Calendar implementation, whiteboard, recordings/transcripts and analytics were not restarted or reconfigured. `.env.local`, `.env.tunnel-test.local`, the original ambiguous guard and original result file retained their preservation hashes.

The existing joining link remained valid at the post-send check. Booking time is unchanged: **24 October, 3:45–4:15 PM Asia/Kolkata**. Guest joining window is **3:30–5:15 PM IST**; invitation expiry is **5:15 PM IST**. The hostname is temporary and must be checked again before later use. Guest OTP delivery is still disabled and requires separate approval before a live verification email can be sent.

## Files and evidence

- `artifacts/qa/smtp-reliability-approved-send.json` — actual safe SMTP result and phase timeline.
- `artifacts/qa/smtp-reliability-approved-send.log` — privacy-safe CLI output.
- `artifacts/qa/smtp-reliability-send-audit.json` — read-only durable-record audit, PASS.
- `artifacts/qa/smtp-reliability-one-shot-preflight.tap` — **18 passed, 0 failed** mock tests.
- New `scripts/smtp-reliability-send-once.mjs` — consumed authorization, durable attempt/dispatch count and terminal outcome handling without any retry loop.
- New `scripts/send-approved-smtp-reliability-once.mjs` — exact reviewed booking/message preflight and at-most-one real SMTP dispatch.
- New `scripts/audit-smtp-reliability-send.mjs` — offline read-only result verification; no network or Gmail access.
- New `tests/smtp-reliability-one-shot.test.mjs` — six one-shot scenarios, run with existing guard and loopback SMTP diagnostic tests.

The preserved preview remains historical review content. Its send authorization/unused-guard assertions are intentionally no longer valid for a new send: the authoritative durable guard is now consumed. Re-running the send CLI is blocked by the existing result file, consumed guard and completed outbox attempt. Do not delete any of those controls.

## Manual inbox confirmation

Please check Gmail manually for **“Talk - Booking confirmed: SMTP Reliability Test”**, sent from and to **niknikhil.sharma22@gmail.com** around **1:37 PM IST**. SMTP acceptance means Gmail accepted the message for processing; it does **not** prove inbox placement or that the user received/read it.

No further email, OTP or retry is authorized. Stop after reporting this result.
