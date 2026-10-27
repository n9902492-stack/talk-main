# Phase 11 — ambiguous Gmail confirmation investigation

Investigated on 24 October 2026. **Classification: Unknown / ambiguous. No real email, SMTP authentication, OTP or retry was performed during this investigation.** SMTP tests used loopback-only mock servers and an external-network egress guard.

## Historical evidence

The original attempt completed its saved result at **12:05:49 PM IST**. The immutable result remains `artifacts/qa/confirmation-approved-send-result.json`:

| Stage | What the retained evidence establishes |
| --- | --- |
| SMTP authentication preflight | `smtp.verify()` returned true; recorded `PASS` |
| Actual dispatch connection authentication | **Not recorded**; Nodemailer opens a separate connection for `sendMail` |
| Application send invocation | Exactly **one** wrapped `sendMail` invocation recorded |
| SMTP MAIL / RCPT / DATA command | **Not recorded** |
| Message body / DATA terminator transmitted | **Not recorded** |
| Final Gmail acknowledgment after DATA | **Not recorded**; `smtpCode` is null |
| Dispatch outcome | Caught failure, `failed_or_acceptance_unknown` |
| Final cleanup | SMTP closed, environment unchanged and isolated disabled-email health confirmed; complete result written |

`sendMail` invocation is not proof of DATA submission. Conversely, `smtpAccepted:false` was its initial application value and does not prove Gmail rejected the message. A lower-level failure **or a wrapper validation failure after a successful SMTP response** can reach this same generic result. The recipient's unsuccessful Gmail search is useful context but cannot distinguish those SMTP paths.

## Why the exact send failure cannot be recovered

- `backend/src/scheduling/transport.mjs` has `logger:false` and `debug:false`; no protocol transcript was generated.
- Its catch converts every transport error into a fixed generic delivery error without preserving safe fields such as error code, SMTP command, response code or transaction phase.
- `scripts/send-approved-confirmation-once.mjs` records only its broad `single authorized dispatch` stage and flattens the final caught error. There is no durable DATA/acknowledgment event history.
- Available controller logs contain only runtime/tunnel readiness and the SQLite experimental warning; they are not SMTP logs. No separate historical SMTP transaction log was found among the controlled confirmation artifacts.
- Configured limits were 15 seconds for connection/greeting/DNS and 25 seconds for socket inactivity. Those settings establish possible failure paths, **not evidence that a timeout actually occurred**.
- The sender caught an error, ran `finally`, closed SMTP, checked disabled-server health and wrote a complete result. This is evidence of handled termination, not an abrupt process kill before the final record. Cleanup runs after the caught dispatch failure, so that final cleanup did not itself cause the preceding failure.

**Timeout, a dropped connection, lost final acknowledgment and a post-response application error remain possibilities. None can be selected as the historical root cause from the retained evidence.** It would be incorrect to mark either confirmed acceptance or confirmed non-submission.

## Guard and no-retry audit

- Actual guard was opened **read-only**: exactly one scope, `consumed=1`, `status=failed_or_acceptance_unknown`.
- Reservation uses `BEGIN IMMEDIATE` and an atomic update requiring the reviewed fingerprint, `consumed=0` and `status=awaiting_approval`. The consumed scope cannot reserve another attempt.
- The original guard and original result file were not changed by the audit. No guard reset, replacement authorization or send CLI invocation occurred.
- Original result still records **one** one-shot invocation and **zero** retries. The ordinary scheduling worker's attempt counter remains zero: that worker was disabled; the one-shot invocation is recorded separately.
- One invitee confirmation remains queued but no other notifications are queued. Both main `SCHEDULING_EMAIL_ENABLED` and isolated runtime SMTP/OTP flags remain false. The queued row is not being delivered by a worker.
- The investigation performed **zero external SMTP connections and zero real sends**. No additional attempt is present in the retained controlled-send records.

Evidence: `artifacts/qa/ambiguous-smtp-audit.json`.

## Targeted tests

**29 passed, 0 failed**, with no external egress:

- Real installed Nodemailer client against an in-process loopback SMTP fixture.
- Successful AUTH and final SMTP 250, distinguished from earlier MAIL/RCPT 250 replies.
- Complete DATA received by the fixture but final acknowledgment withheld: socket timeout, ambiguous result, consumed guard prevents retry.
- Connection drop after complete DATA: ambiguous, no retry.
- Connection drop before DATA: demonstrably not submitted under complete diagnostic coverage.
- Greeting timeout and authentication rejection: no DATA submission or send after failed preflight.
- Application failure after a real mock final 250: phase evidence retains confirmed SMTP acceptance despite the application error.
- Concurrent independent worker threads can reserve only one attempt.
- Restart/interrupted reserved state remains consumed; changed message/booking cannot use another review.
- Diagnostic redaction rejects AUTH payloads, email addresses, private URLs, body content, connection identifiers, provider text and raw error details.
- Existing SMTP transport and one-shot smoke safeguards pass regression tests.

Log: `artifacts/qa/ambiguous-smtp-targeted.tap`. Node syntax check also passed.

## Diagnostic foundation for a future test

New `scripts/confirmation-smtp-diagnostics.mjs` is a passive, phase-only logger/classifier. It opens no socket. Tests use it with `transactionLog:true`, `debug:false` and a strict custom logger that retains only timestamps, fixed command categories, numeric replies, local stream-completion markers and allowlisted error categories. AUTH contents, MIME content, addresses, provider messages and raw errors are discarded before persistence.

The helper explicitly separates authentication-preflight and send connections. Local stream completion is not treated as server acceptance; only the final post-DATA acknowledgment establishes acceptance. A missing acknowledgment stays ambiguous.

**This foundation has not been activated in any running environment or connected to the consumed send script.** Production adapter, sender, attempt guard implementation, environment files, booking records, main app and public tunnel were preserved. Only the passive helper and mock tests were added/extended.

## Safe next controlled test — recommendation only

1. Keep the original guard consumed and original evidence intact. Do not retry that authorization.
2. Review one new test scope with a unique subject/Message-ID and a valid future booking/link if the current appointment has expired. Do not create it or send anything without separate approval.
3. Before any newly approved single send, enable the tested **redacted phase diagnostics only in that one-shot process**; do not enable raw debug output or a general SMTP worker.
4. Persist phase transitions and the final numeric acknowledgment before performing recipient/result assertions, and persist sanitized error fields before the adapter's generic error wrapper discards them.
5. Keep one durable reservation and no retries. If DATA has begun and no final acknowledgment arrives, preserve an ambiguous result and stop again.

No new live test has been armed or executed. Separate explicit approval is required before any further real message.
