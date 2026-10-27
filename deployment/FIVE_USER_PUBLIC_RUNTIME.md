# Temporary five-user public runtime

24 October 2026, Asia/Kolkata. Started under the user's explicit approval for a new isolated runtime and temporary Quick Tunnel. No emails or OTPs are authorized or sent.

## Working address

**https://unfortunately-directory-clearing-yorkshire.trycloudflare.com/sign-in**

Final HTTPS/security recheck passed at **24 October 2026, 15:53:56 IST**. Socket ownership verified `127.0.0.1:3003`, PID 24540.

Meeting: `https://unfortunately-directory-clearing-yorkshire.trycloudflare.com/device-test?room=m-3add04ea-20ab-48c1-a6bc-e62f5fc251b3`

This meeting URL requires normal verified-account authentication and host admission. It is not an invitation credential or a permanent media token. No old Cloudflare origin was reused. The URL is temporary and depends on the running connector and isolated server.

## Runtime isolation and processes

| Item | Verified configuration |
| --- | --- |
| Listener | `127.0.0.1:3003`, loopback only |
| Database | `data/five-user-public-test/run-Ofjpbs/talk.sqlite` |
| Frontend | Existing tested bundle in `artifacts/qa/five-user-build` |
| Server | PID 24540, independent parent process |
| Connector controller | PID 10396, independent parent process |
| cloudflared | PID 25668, owned only by the connector controller |
| Public origin | Newly assigned origin above |
| Scheduling public URL | Set only inside the isolated server process |

The server does not start, stop or watch the connector. The connector does not start, stop or watch the server. Raw connector output is consumed in bounded memory and not persisted; only safe origin/status information is written. Server/connector status files use atomic replacement. No public control or shutdown endpoint exists.

The first server startup was blocked by Windows `EPERM` on the new private status directory. The directory ACL was corrected to grant the runtime identity access while retaining access for the preparing identity. No public tunnel had started when this failed. Subsequent server startup and separate connector startup succeeded. Only this new directory's permissions changed.

The main application was not started, stopped, restarted or reconfigured. Existing environment files, prior isolated test database and both SMTP send guards/results were verified byte-for-byte unchanged. The original SMTP ambiguous guard remains consumed; the later accepted-send guard remains consumed. No retries occurred.

## Authentication readiness: important limitation

The existing configuration contains **five distinct approved emails**, kept private and unchanged. The previous isolated test database contained **three verified password accounts**. Only those three verified account identities and their existing password hashes/verification timestamps were imported into the fresh database with new local account IDs. No passwords were generated/reset; no sessions, old bookings, old meetings, recordings, transcripts, whiteboards or Calendar records were copied. The main application's accounts were not imported.

Those three testers can sign in with their existing isolated-test passwords. **The remaining two cannot authenticate yet**: their verified password identities are absent. Signup/email-verification delivery remains disabled. They must complete the normal verified onboarding process under separate email approval; they are not silently marked verified. Google and phone authentication are disabled only in this temporary adapter; the main application's authentication is unchanged.

The synthetic host is the first available verified tester in the existing allowlist order. Its identity mapping is stored privately at `data/five-user-public-test/run-Ofjpbs/host-account.private.json`; it contains no password. Do not publish this mapping or the allowlist.

Local tests exercised five separate verified fixture accounts successfully, but **five real public account sign-ins have not passed**. The public browser test intentionally used no real accounts.

## Data and booking confirmation

The new database contains only the imported test-auth identities, a newly generated synthetic booking/event and a separate immediately joinable synthetic meeting. LiveKit media rooms are not created during preparation.

Synthetic booking: **24 October 2026, 17:45–18:15 IST**, Asia/Kolkata. Its signed confirmation remains valid until **19:15 IST** under the existing end-plus-one-hour policy. Scheduled guest joining is 17:30–19:15 IST and still requires guest email proof and admission; guest OTP delivery is disabled, so anonymous booking guests cannot complete that flow now.

This future booking is separate from the immediately joinable five-user test meeting linked above. Verified accounts use the test meeting now; they do not bypass a scheduled booking's joining window.

The full signed confirmation is stored only in the protected Git-ignored file `data/five-user-public-test/run-Ofjpbs/confirmation-link.private.json`. Its current-origin signature, expiry, actual confirmation page and downloadable ICS timestamps passed HTTPS checks. Credentials are not printed in reports or logs. The frontend removes the credential fragment from the address bar and restores its private confirmation after reload within that browser session.

## Enabled route scope

- Pages: `/`, `/sign-in`, `/sign-up`, `/verify-email`, `/dashboard`, `/bookings`, `/meetings`, `/booking-confirmation`, `/device-test`, `/meeting`, and bounded `/booking/:host/:event` pages. Signup/verification pages render but cannot send codes.
- Authentication: config/session, approved email/password login/resume, logout and existing verification handlers with mail disabled. No fabricated authentication verifier is installed publicly.
- Workspace: each host's own scheduling dashboard/profile/event management, availability, own booking detail/change and bounded booking statistics/delivery-disabled status. Calendar exposes its disabled status only; no authorization callback, provider writes or invitations.
- Booking confirmation: signed detail and ICS, mandatory guest proof/redeem/session endpoints. The email-code endpoint returns disabled; a guest cannot obtain media access without proof.
- Booking creation: only authenticated approved accounts can book, and the submitted invitee email must match the authenticated account.
- Meetings: create, metadata/state, disabled recording-state, token and existing moderation actions. The meeting-list summary is restricted by normal account authorization and reads only this isolated database.
- Media signaling: only `/api/auth/meeting-signal/rtc` and `/api/auth/meeting-signal/rtc/v1` WebSocket paths, with exact origin validation and existing single-use opaque ticket authorization. Chat and screen sharing use the existing LiveKit connections.
- Static content: built frontend assets/vendor/fonts, without source maps, directory listings or project-root serving.

Unrelated admin, recording, transcript, whiteboard/AI, analytics-page, password-reset, phone/Google auth and live Calendar APIs remain inaccessible. Browser-side navigation links for unsupported features do not grant backend access.

## Security and disabled services

- Exact newly assigned Host/HTTPS origin; validated Cloudflare client IP; user-supplied forwarded headers discarded.
- Secure, HttpOnly, SameSite=Lax cookies with `fiveuser_` namespace, preventing collisions with localhost development and booking-test cookies.
- Existing CSRF checks, auth and scheduling rate limits, OTP single-use/expiry/attempt rules preserved.
- Five-email enforcement on login/signup/resume and authenticated sessions.
- Every new meeting requires approval; `approval_off` is blocked in this runtime. Host/member roles and cross-room authorization remain enforced.
- Invalid, tampered, stale-version and cross-booking credentials rejected. Expired links and unauthorized sessions covered in local tests.
- SMTP, guest OTP delivery, reminders, host notifications, SMS, recording, transcription, Gemini and live Calendar operations remain disabled. No mail adapter/provider credentials are installed in the runtime. Queued jobs have no sending transport; preparation cancelled the synthetic fixture's jobs.
- Secret scanning passed against frontend assets, including the dedicated backend signing secret. Private fixtures/data are Git-ignored and stored in the restricted data directory.

## Verification results

| Verification | Result |
| --- | --- |
| Local regression suite | **100 passed, 0 failed** |
| New adapter security cases, repeated after final preparation change | **4 passed, 0 failed** |
| Actual HTTPS health, routes, invalid links, authorization and ICS | **PASS** |
| Public browser desktop/mobile sign-in/signup | **PASS**, 1440px and 390px, no horizontal overflow |
| Anonymous protected workspace navigation | **PASS**, normal sign-in required |
| Actual signed confirmation rendering and reload | **PASS**, zero uncaught browser errors |
| Five real public account logins | **NOT VERIFIED**; two verified identities missing |
| LiveKit Cloud authenticated read-only API | **PASS**, no rooms/resources created |
| LiveKit Cloud actual public audio/video | **NOT TESTED** |
| Public screen sharing / five external devices | **NOT TESTED** |
| Previous five-browser loopback SFU/media test | **PASS**, historical local evidence; not relabeled as Cloud/public media |
| TypeScript | **PASS** |
| Frontend build | Reused prior verified production bundle; no frontend changes in this task |
| New real emails, OTPs, Calendar invitations | **0** |
| SMTP guards and existing configuration preservation | **PASS** |

Evidence: `artifacts/qa/five-user-public-regression.tap`, `five-user-public-security.tap`, `five-user-cloud-readiness.json`, `five-user-public-https.json`, `five-user-public-browser.json`, and `smtp-reliability-send-audit.json`. The latter audits the earlier accepted email, not a new send. Early new-test assertion failures were corrected to expect the scheduling service's existing privacy-preserving 404 for unauthorized/tampered booking access; no security check was weakened.

## Manual testing and remaining approvals

1. Open the sign-in address in separate browser profiles/devices. The three already verified testers use their existing test passwords. Host identity mapping remains local/private.
2. Host opens the shared test meeting. Other authenticated testers use the same meeting URL, check devices and wait for admission. Host admits them through People. No audio/video should connect while waiting.
3. Check cameras/microphones, chat and reconnection. One desktop tester shares a non-private moving test window; every receiver confirms decoded updates. Test removal and ensure that account cannot rejoin without host reauthorization.
4. Follow `deployment/FIVE_USER_PUBLIC_TESTING_SCREEN_SHARING.md` for the complete five-device/network plan once the other two accounts are normally verified.

No additional approval is needed merely to open this newly authorized temporary environment. **Separate approval is still required for any real verification email, OTP or invitation.** Do not enable general SMTP, reset send guards or alter main account verification. Do not claim all-five public success until those account and actual media/device checks have been completed.

To stop this temporary environment, first verify the current PIDs against the private server/connector status files and their executable/script identities. Stop only its cloudflared PID, its connector-controller PID and its server PID. Do not target port 3001 or unrelated processes. Restarting with a new public origin requires a new deliberate launch; the preparer refuses to duplicate an existing launch manifest.

## Files added

- `backend/src/five-user-test.mjs`
- `scripts/check-five-user-identities.mjs`
- `scripts/prepare-five-user-public.mjs`
- `scripts/serve-five-user-public.mjs`
- `scripts/serve-five-user-connector.mjs`
- `scripts/check-five-user-cloud.mjs`
- `scripts/verify-five-user-public.mjs`
- `tests/five-user-public.test.mjs`
- `tests/five-user-https-browser.mjs`
- This report; private evidence/launch descriptors under Git-ignored data/artifacts.

No main application, main database, `.env.local`, `.env.tunnel-test.local`, LiveKit credentials or existing tunnel configurations were changed.
