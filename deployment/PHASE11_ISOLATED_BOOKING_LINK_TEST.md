# Isolated booking confirmation and guest joining test

Prepared 23 October 2026. Local testing only; no public tunnel or email send is authorized by this preparation.

## Runtime and data

- Entry point: `scripts/booking-link-test.mjs`.
- Adapter: `backend/src/scheduling/booking-link-test.mjs`.
- Loopback listener: `127.0.0.1:3003`.
- Dedicated frontend build: `artifacts/qa/booking-link-frontend`. The existing `frontend/dist` build was stale and is preserved.
- Prepared fixture database: `data/booking-link-test/run-k4g1R9/talk.sqlite`.
- The fixture contains one synthetic host account, one event/booking and its scheduled meeting; no existing account, meeting, recording, transcript or whiteboard data is copied.
- The first two entries of the unchanged five-email list are used as synthetic host/invitee addresses. This is fixture provisioning, not proof of ownership of a real mailbox. The host has a new random, unique password stored privately in `host-access.private.json` within that fixture directory. No password is printed.
- `invitation.private.txt` in the same directory contains the private synthetic confirmation link. Do not paste its bearer fragment into chat or logs. Neither file is served over HTTP. Both are Git-ignored.
- The signing key is read from `.env.local`, LiveKit settings and the five-email list from `.env.tunnel-test.local`; neither file is changed. No SMTP configuration is loaded by this runtime.
- Every normal outbox job in the new fixture is cancelled. The regular worker has no transport. Guest email codes are unavailable rather than bypassed.

## Scope and authorization

Frontend pages: `/`, `/sign-in`, `/booking-confirmation`, `/device-test`, `/meeting`, plus compiled assets/fonts/vendor files. Source maps, private files, development tools and administrative routes are blocked.

Allowed API operations:

- `GET /healthz`, auth config/session and email/phone capability configuration (phone disabled).
- Allowlisted email/password login/resume and logout. No signup, password reset, Google or SMS endpoints.
- `GET /api/auth/scheduling/form` for the existing short-lived form challenge.
- `POST /api/auth/scheduling/booking/<fixture-booking-id>/{detail,calendar,code,redeem}`.
- `GET /api/auth/scheduling/guest/meetings/<fixture-meeting-id>[/state]` and `POST .../{token,actions}`.
- Existing host meeting detail/state/recording-state reads and token/moderation actions, restricted to the synthetic meeting ID. Host authentication and CSRF remain mandatory.
- WebSocket upgrades only on `/api/auth/meeting-signal/rtc[/v1]`, with exact host/origin and existing session-bound ticket validation.

Booking creation, rescheduling/cancellation APIs, dashboards/analytics, private recordings, transcripts, whiteboards and AI APIs are not exposed. Existing UI management buttons can therefore report an unavailable action in this restricted runtime. After host login, open `/device-test?room=<fixture-meeting-id>` directly: the unrelated dashboard is intentionally unavailable.

## Link verification and security

Scheduling now accepts an independent `links` verifier, defaulting to the existing transport's verifier for backward compatibility. Email link verification therefore works with `transport:null`; configuring a link verifier does not enable SMTP. Signed detail access additionally requires an unexpired, non-revoked invitation. Existing recording, authentication, meetings and ordinary scheduling integrations remain unchanged.

Existing HMAC credentials bind booking ID and version, expire one hour after the booking ends and reject cancellations/version changes. Guest admission still requires a booking credential, unexpired invitation, correct single-use email proof, valid joining window, a scoped guest session, and host admission. A link alone is insufficient to enter a media room.

The adapter restricts API paths to the fixture's booking/meeting. It preserves authentication, rate limiting, origin/form challenge/CSRF validation and moderation permissions. Cookies receive the `bookingtest_` prefix in both directions because cookies are shared across localhost ports. Development/tunnel cookies are neither accepted nor overwritten.

Public-origin mode requires one exact HTTPS `*.trycloudflare.com` origin, forwarded HTTPS and a valid Cloudflare client-IP header; cookies become Secure/HttpOnly/SameSite=Lax. Local mode rejects forwarded requests. The server always binds loopback. Mock OTP delivery is injected only by tests and refused in public-origin mode. Private keys are scanned out of the isolated build before startup. Paths require confinement and a dedicated synthetic database marker.

## Local commands

The current prepared runtime can be started in a terminal once port 3003 is free:

```powershell
node scripts/booking-link-test.mjs --start --fixture data/booking-link-test/run-k4g1R9
```

For a fresh synthetic booking (existing fixtures are retained):

```powershell
node scripts/booking-link-test.mjs --prepare
```

Use the returned directory with `--fixture`. Preparation creates no listener. Restart with the same directory retains the booking and credentials. Fixtures have real, short booking windows; prepare a fresh fixture if the appointment has expired.

Build the isolated frontend without replacing the public/development build:

```powershell
node node_modules/vite/bin/vite.js build --config frontend/vite.config.ts --outDir ../artifacts/qa/booking-link-frontend
```

## Verification

Evidence is stored under `artifacts/qa/booking-link-test-*`:

- Broad scheduling/email/authentication regression: 122 passed, zero failed/skipped; includes the original four isolated-runtime tests.
- Final focused runtime suite: five passed, zero failed/skipped, including tampering, expiry, revoked invitations, version changes/cancellation, cross-booking/meeting restrictions, mock email proof, one-time redemption, waiting-room/host admission, removal, rate limiting, DB persistence/reopening and HTTPS-cookie/origin checks. These overlap the broad suite and are not additive totals.
- TypeScript/repository lint passed.
- Isolated production frontend build passed (existing large-chunk warning remains).
- Automated tests run under `tests/helpers/cloud-egress-guard.mjs`; all external destinations are blocked. SMTP/email proof uses mocks only.
- Local health/sign-in/confirmation HTML return 200; private files and unrelated APIs return 404.

The browser verification script is `tests/booking-link-local-browser.mjs <fixture-directory>`. It **passed** against the running port-3003 runtime: actual compiled confirmation page and signed detail loading, disabled verification notice and password authentication using only the private synthetic host fixture. It permits loopback browser requests only. Its result is recorded separately in `booking-link-test-browser.log`.

Real Gmail authentication/delivery, actual mailbox ownership proof, internet HTTPS access and real LiveKit audio/video are not established by these mock-based security checks.

## Remaining approval gates and later Quick Tunnel launch

No suitable HTTPS origin exists yet. `SCHEDULING_PUBLIC_URL` is unchanged. A later public launch and route exposure require explicit approval. These commands are instructions only and were not executed:

1. Confirm the isolated test has no active meeting. Stop only this runtime's port-3003 process (Ctrl+C when run in the foreground). Never stop the development server, original WebRTC tunnel, database or LiveKit service.
2. Start the official Quick Tunnel client in a separate terminal:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --metrics 127.0.0.1:20243 --url http://127.0.0.1:3003
```

3. Record only its assigned HTTPS origin. Initial forwarding is rejected until the isolated runtime is configured for that exact origin. Start only the isolated runtime with:

```powershell
node scripts/booking-link-test.mjs --start --fixture data/booking-link-test/run-k4g1R9 --origin https://ASSIGNED-NAME.trycloudflare.com --approved-public-origin
```

The `--approved-public-origin` flag is an operator authorization assertion, not permission to launch now. It does not modify any env file. Startup regenerates the fixture's private invitation file for that origin using the same signing key. Leave the tunnel terminal running and keep the laptop awake.

4. Verify public pages, private-file denial, exact-origin checks and the real signed booking detail route. Only after this verification and separate approval should `SCHEDULING_PUBLIC_URL` and the exact one-message email preview be prepared.
5. **Guest email proof is still blocked:** no real code can be delivered while SMTP is disabled. A separate, explicitly approved OTP delivery path is required before a real guest can complete joining. The one-confirmation-email authorization does not cover additional verification emails. Do not reveal mock codes publicly, bypass proof, enable the normal outbox, or enable Gmail sending just to make a link work.

Shut down this Quick Tunnel with Ctrl+C when the approved test ends. Stop only the isolated runtime when idle; keep its SQLite files for review. No database rollback or production migration is required.
