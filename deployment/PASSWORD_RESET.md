# Email password recovery

On `/sign-in`, **Forgot password?** opens `/forgot-password` using the existing Talk authentication layout. Enter a verified email/password account's address, verify the emailed six-digit code, enter the new password twice, then sign in. Google-only and phone-only accounts retain their existing provider sign-in and cannot gain a password through recovery.

The existing server-only Gmail SMTP configuration sends password-reset emails. No additional environment variables are required. The request response is identical for existing and unknown accounts; checking the inbox is necessary to establish ownership.

## Backend

All routes use `/api/auth/email/password-reset`:

| Method | Suffix | Purpose |
|---|---|---|
| GET | (none) | Resume a browser-bound recovery challenge and obtain CSRF token |
| POST | `/request` | Validate public CSRF and queue email delivery |
| POST | `/resend` | Rotate the challenge and invalidate older codes |
| POST | `/verify` | Exchange the code for a five-minute password-change grant |
| POST | `/complete` | Atomically change password, consume grant and revoke sessions |

Write endpoints require the existing trusted origin, JSON and CSRF protections. Recovery uses its own HttpOnly cookie, separate from signup verification. HTTPS deployments keep Secure cookies and the encrypted Firebase Hosting cookie adapter. Codes expire in five minutes; resending requires sixty seconds; a challenge permits five attempts. Additional IP/email rate limits apply. Passwords use existing salted scrypt hashing; only hashes of reset tokens and codes are stored.

SQLite migration `010_password_reset.sql` and PostgreSQL migration `008_password_reset.sql` add `password_reset_challenges`. The application worker claims persisted email jobs, limits retries and recovers stale delivery claims after restart. Keep the backend running to process queued delivery; a scale-to-zero platform needs an available worker/CPU just as other background processing does. An SMTP acceptance followed by a process crash may produce a duplicate email; only the current challenge/code can succeed. Failed delivery stays generic to protect account privacy; use Resend after the cooldown.

Completing recovery invalidates other reset challenges and pending email challenges for the account, deletes all login sessions, and revokes meeting connection tickets. It never automatically signs the user in. Signup, Google and phone sign-in remain separate.

## Verification

- `node --test --test-concurrency=1 tests/password-reset.test.mjs tests/verification-mailer.test.mjs`
- `node scripts/test-production-postgres.mjs --password-reset-only` (disposable local PostgreSQL)
- `npm run build:whiteboard` then `node tests/password-reset-browser.mjs` (isolated build, real Chrome/HTTP/SQLite, fixture SMTP)
- `npm run lint`

Automated tests do not send email or SMS. Real inbox delivery must be checked using the running app and its configured SMTP transport. Codes and credentials must not be copied into logs or test artifacts. The separate public tunnel's environment, allowlist and build were intentionally left unchanged; this feature has not been deployed there.
