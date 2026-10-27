# Temporary free Talk team test

This setup runs the built Talk frontend and its existing authentication and meeting backend on your laptop at **http://127.0.0.1:3002**. A Cloudflare Quick Tunnel can provide a temporary HTTPS address after you approve public access. LiveKit Cloud carries the meeting audio, video, and screen sharing directly between participants and its servers.

Start with your own email address for a one-person smoke test. Later expand to five people in two simultaneous meetings: Meeting A with three people and Meeting B with two. This is a temporary test, with no Google Cloud or Firebase Hosting deployment, SMS, recording, or transcription.

## Current approval boundary

Local preparation and checks are authorized. **Do not start `cloudflared tunnel` or share a public Talk address until the owner explicitly approves opening public access.** Installing or checking the official client does not open a tunnel.

The public launch approval must cover:

- Opening a temporary Cloudflare Quick Tunnel to this laptop's port 3002.
- Configuring Talk to accept the one exact HTTPS hostname that Cloudflare assigns.
- Opening the address for the listed tester accounts, starting with your own account. Each tester creates an individual email/password test account and completes email verification.
- Using the existing LiveKit Cloud Build project within its remaining free allowance, initially for the one-person test and later for two rooms and five participants.

This approval does not include paid upgrades, Google Cloud resources, SMS, recording, transcription, or exposing any development or database service.

## Private configuration

Use this Git-ignored file next to the root `package.json`:

`C:\Users\ss828\Downloads\talk-main\.env.tunnel-test.local`

Keep the three existing LiveKit values there. Add your own email address first. The allowlist supports one to five distinct real test email addresses:

```dotenv
LIVEKIT_URL="wss://YOUR-PROJECT.livekit.cloud"
LIVEKIT_API_KEY="YOUR_PRIVATE_API_KEY"
LIVEKIT_API_SECRET="YOUR_PRIVATE_API_SECRET"
TUNNEL_TEST_EMAILS="your-email@example.com"
```

These are placeholders for this guide, not working credentials or pre-created accounts. Enter the actual values privately in your editor. Later, add the other testers' email addresses separated by commas, keeping the total at five or fewer. Restart the temporary Talk backend to load changes; editing the file does not update a running allowlist. Do not put passwords, email OTPs, API secrets, or session cookies into chat, command arguments, screenshots, or Git.

The temporary launcher reads LiveKit configuration from this file. It reuses only the required SMTP settings from the existing `.env.local` internally; it does not overwrite that file or import unrelated runtime configuration. SMTP stays on the backend. No `VITE_` LiveKit secret variables are needed.

The temporary runtime uses **`data/tunnel-test/talk.sqlite`**, protected by a test-database marker. It does not copy or open the usual Talk database, production PostgreSQL database, or private recording files. Keep this test database in place between local restarts so your test accounts and meeting ownership remain available. Do not run production migration/import commands for this test.

## Install the official Cloudflare client if missing

Download the Windows client from [Cloudflare's official downloads page](https://developers.cloudflare.com/tunnel/downloads/). Choose the version matching your Windows architecture, follow the official installation instructions, and reopen PowerShell if PATH changed. No Cloudflare account, named tunnel, domain purchase, or billing upgrade is required for a Quick Tunnel.

Check installation only:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" --version
```

The installed Windows client at this exact path was verified as **2026.10.1**. The test launcher checks this full path before attempting PATH discovery, so a PowerShell PATH update is unnecessary. If another machine installs it elsewhere, use its actual full path. Do not run a tunnel command during local preflight.

## Local preflight — no public access

Run from the project root:

```powershell
Set-Location -LiteralPath 'C:\Users\ss828\Downloads\talk-main'
npm run build
npm run tunnel-test:check
npm run tunnel-test:start
```

The application must bind only to `127.0.0.1:3002`. Open **http://127.0.0.1:3002** on the laptop. This is the built application, not the Vite development server. Port 3001, database ports, development tools, source files, environment files, and administrative interfaces must not be forwarded.

The check should confirm configuration and isolation without showing credentials or creating accounts. At least one test email is required before using a public origin; your own address is enough for the first test. Add missing addresses and repeat the check. A preflight test must not send real email or SMS automatically. Normal deliberate signup sends the existing email verification message.

The local runtime permits loopback browser access only. Public-host requests remain denied until the exact HTTPS origin is supplied explicitly. A local camera test may work on loopback because browsers treat localhost specially; that does not prove access from another network.

### Local verification on 19 October 2026

- `npm run test:tunnel-test`: 10 tests passed, including five distinct email/password fixture accounts, waiting-room admission into two rooms, exact Origin/Host/CSRF checks, Secure cookie headers, client-IP rate limiting, private-path denial, and revoked access after an email is removed from the allowlist.
- The WebSocket test transmitted frames through the existing gateway to a local upstream fixture and verified that refreshed LiveKit JWTs remained private. It did not connect to LiveKit Cloud or transmit real meeting media.
- `npm run test:meetings`: 19 tests passed. `npm run test:auth`: 62 tests passed, including the normal Google, Email OTP and phone authentication regressions. Provider delivery in these tests is simulated.
- Lint and the production frontend build passed. The build was scanned for the saved private LiveKit and SMTP values without displaying them.
- The actual built site loaded in local Chrome at desktop and mobile viewport sizes. Sign-in, sign-up and private-path restrictions passed. A local startup/graceful-shutdown cycle passed.

No real verification email, SMS, public Cloudflare request, Cloud meeting media or remote-device test was performed in this preflight. SMTP configuration was validated locally; successful email delivery still requires deliberate signup. LiveKit Cloud API authentication passed separately before this preparation. The normal application remains unchanged; this temporary adapter accepts email/password authentication only.

## Public launch — only after explicit approval

Use two PowerShell terminals. Keep the local-only Talk process running initially, so a newly opened tunnel cannot immediately expose the application to an unapproved hostname.

In the second terminal, after public-launch approval, start the Quick Tunnel:

```powershell
node scripts/start-approved-tunnel.mjs --approved
```

The controller uses the verified full executable path above, binds connector metrics to loopback, and prints only the assigned HTTPS origin and fixed status messages. Raw Cloudflare request logs are suppressed to avoid recording session-bound meeting tickets. It records the public origin and connection status in ignored `data/tunnel-test/public-tunnel.json`; this file contains no credentials. Copy the assigned address. The local-only Talk process should still deny requests using this public hostname.

In the Talk terminal, press **Ctrl+C**, then restart with that one exact origin:

```powershell
npm run tunnel-test:start -- --origin https://EXACT.trycloudflare.com
```

Replace the example with the actual assigned origin. Do not add a path, wildcard, or a second hostname. The public-mode runtime uses secure host-only session cookies, exact Origin/CSRF validation, and matching WSS Origin validation. Meeting signaling uses that same hostname; LiveKit API secrets stay on the backend. Local HTTP browser login is not the public-mode test path because the cookies require HTTPS.

Visit the assigned HTTPS address yourself before sharing it. Confirm the landing page, sign-in page, and a direct frontend route load correctly. The temporary runtime is limited to the listed email accounts and the required meeting/profile routes; unrelated providers and recording/transcription operations remain unavailable in this test runtime. The normal Talk application is unchanged.

Each tester must use their own password and mailbox. Complete **Sign up → email OTP → dashboard** individually. Never use a shared or hardcoded password. No test accounts exist merely because their email addresses were listed in the environment file.

## First test by yourself

With only your email on the allowlist, create your test account, verify its email, sign in, create a meeting, and check the existing pre-join camera/microphone tests and meeting controls. Then leave and sign in again to check account persistence. A one-person test does not verify another participant receiving audio, video, chat, or screen sharing.

When you are ready for the team test, stop the tunnel first and then the temporary backend, add the other email addresses to `TUNNEL_TEST_EMAILS`, and repeat the configuration check. Obtain approval before starting public access again. Restart the backend using the exact current tunnel origin, then share the URL privately with the listed testers. Keep the existing test database; do not recreate accounts or reset meeting ownership just to expand the allowlist.

## Five-person test

Before launch, check the LiveKit dashboard for the **Build free plan** and remaining participant-minute and data-transfer allowances. Do not upgrade or add a paid plan. Stop testing before a free allowance is exhausted; this guide does not verify the account's current quota or authorize billable usage. A random Quick Tunnel URL is temporary and is not an access-control secret.

Use separate real laptops or phones on different Wi-Fi/mobile networks:

1. All five people authenticate using the temporary test accounts.
2. One authenticated host creates Meeting A with host approval required and shares its link with two teammates.
3. Another authenticated host creates Meeting B with host approval required and shares its link with one teammate.
4. Hosts admit the correct waiting participants. Confirm a waiting participant receives no meeting audio, video, chat, or participant details before admission.
5. Run both rooms simultaneously. Verify people in A cannot see, hear, or receive chat from B, and vice versa.
6. Test camera/microphone controls, camera-off avatars, screen sharing, chat, reactions, host removal, and reconnecting after a short network interruption.
7. Test a mobile participant's camera/microphone permissions. Screen sharing depends on browser and operating-system support; desktop browsers provide the most complete sharing workflow.
8. End both meetings through their hosts when finished.

With host approval enabled, guests must click **Join session** after checking their devices. They then see **Waiting for host to let you in**. Inside the same room, the host sees a waiting-room notice and a count on **Participants**. New requests open that panel when no other panel is in use; choose **Admit**, **Deny**, or **Admit All** there. Admission requests come from the test database and remain available if LiveKit's presence lookup fails. A failed controls refresh displays **Retry meeting controls**; it does not admit anyone automatically.

Read-only LiveKit authentication, isolated backend tests, and simulated browser tests are useful preflight checks. They do **not** prove remote WebRTC works. The final test requires real media received on different devices and networks. External LiveKit WSS connectivity, ICE/TURN behavior, browser permissions, audio echo, and network restrictions remain pending until this manual test succeeds.

## Availability and network limits

The laptop must remain awake, connected to the internet, and running both Talk and `cloudflared`. Closing either process, sleeping the laptop, or losing its connection interrupts access. No router port forwarding is needed.

Quick Tunnels provide a temporary address with no availability guarantee. A restarted tunnel can receive a different hostname. Restart Talk with the new exact origin and share new links; previous-domain cookies do not carry to the new hostname, so testers must sign in again. Do not disable Origin checks to reuse an old link.

Browsers need HTTPS for remote camera, microphone, and screen-capture permissions. Corporate firewalls, VPNs, blocked UDP, restricted mobile browsers, and captive portals can affect WebRTC. LiveKit's secure signaling and available ICE/TURN paths must be validated on the actual networks; a working page alone is insufficient.

## Safe shutdown and restart

When Codex starts the approved test in hidden background processes, there may be no terminal to close. Ask Codex to stop the temporary public test when finished; it must identify and stop this test's Cloudflare connector first, then this test's backend, without stopping unrelated Node processes. Closing the editor or its terminal does not confirm that these background processes stopped. The ignored `data/tunnel-test/public-tunnel.json` file records the connector/controller process IDs and a heartbeat, but a live process and network check is still required to confirm availability or shutdown.

When possible, hosts first choose **End Meeting for Everyone** in both rooms. Then:

1. In the Cloudflare terminal, press **Ctrl+C** first to stop public ingress.
2. In the Talk terminal, press **Ctrl+C** to close the backend and its meeting signaling connections.
3. Confirm neither test process is still running before leaving the laptop unattended. Do not stop unrelated Node or database processes.

Keep the private environment and test database separate from normal development data. Do not delete SQLite files while the test backend is running. Deleting test data is a separate cleanup action and is not required to stop public access.

For a later session, repeat the quota check and local preflight. Starting another public tunnel still requires the owner's approval; earlier approval does not authorize a permanent public service or paid infrastructure.
