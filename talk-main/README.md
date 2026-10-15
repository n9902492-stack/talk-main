# Talk

React/Vite implementation of the supplied Stitch landing-page design, with webinar, booking, device-check, and meeting preview screens based on the supplied recording.

## Architecture

| Guide | What it explains |
| --- | --- |
| [FRONTEND.md](FRONTEND.md) | Screens, components, styles, routing, browser authentication and where to change the UI |
| [BACKEND.md](BACKEND.md) | API endpoints, authentication flows, databases, sessions and development/production setup |

Frontend code lives in `src/`; backend code lives in `server/`. Both use the existing root `package.json`. In development, `npm run dev` serves the website and authentication API together at http://localhost:3001.

## Run locally

```powershell
npm install
npm run dev
```

- Landing: http://localhost:3001/
- Webinar: http://localhost:3001/webinars
- Audio/video test: http://localhost:3001/device-test
- Meeting preview: http://localhost:3001/meeting
- Booking preview: http://localhost:3001/bookings
- Sign in: http://localhost:3001/sign-in
- Sign up: http://localhost:3001/sign-up
- Email OTP verification: http://localhost:3001/verify-email (opens automatically after signup)
- Phone number entry: http://localhost:3001/phone-sign-in
- Mobile OTP verification: http://localhost:3001/verify-phone (opens after requesting an SMS)
- Dashboard: http://localhost:3001/dashboard
- Account selection: http://localhost:3001/choose-account
- Google sign-in confirmation: http://localhost:3001/confirm-sign-in

## Google sign-in

Both account pages use the official Google Identity Services button. Google credentials are verified on the server before an opaque HttpOnly session cookie is issued. New Google sign-ins first open Talk's `/confirm-sign-in` profile review: **Continue** confirms the pending session and opens the dashboard; **Cancel** signs out of Talk and returns to account selection. Refreshing preserves the session's confirmation status. Email/password signup and login use the same session system after email verification, and open the dashboard directly.

1. Create a **Web application** OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/clients) and complete its branding/audience setup. If the app is in testing, add the Google accounts that will test it.
2. Add `http://localhost` and `http://localhost:3001` to **Authorized JavaScript origins**. If using the numeric host, also add `http://127.0.0.1` and `http://127.0.0.1:3001`. This popup flow does not require a redirect URI or a client secret.
3. In `.env.local`, set `GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com` and `APP_URL=http://localhost:3001`. Restart `npm run dev` after changing configuration. The ID is public; never add a client secret to frontend configuration.
4. Open `/sign-in` or `/sign-up` and choose **Continue with Google**.

The **Choose an account** link opens Talk's `/choose-account` entry page. It shows only the currently authenticated Talk profile; other Google accounts are selected in Google's official sign-in window. The dashboard account menu also offers **Switch account**. Google controls the layout and available Google accounts in its hosted chooser. To change the app name/logo shown there, configure **Google Auth Platform → Branding** in the Cloud project associated with `GOOGLE_CLIENT_ID` (application name `Talk`, your Talk logo). These OAuth branding settings cannot be set through local HTML.

Talk's confirmation page reviews only the verified name, profile picture and email address received after Google's own authorization. It does not replace Google's consent screen, request extra Google scopes, or collect a Google password. Cancelling revokes the Talk session; it does not remove a Google account connection already authorized at Google. The page links to Google's account connections settings for that action. Pending Google sessions are redirected to confirmation when visiting the dashboard, and cannot link password sign-in before continuing. Existing confirmed sessions are preserved by migration `002_google_confirmation.sql`.

Vite serves the authentication API during development. To serve a built app with authentication, run `npm run build`, then `npm start`; `vite preview` serves static files only. Remote deployments must set `APP_URL` to the public HTTPS origin and set `HOST`/`PORT` for the hosting environment. Accounts, verification challenges, sessions and rate limits persist in SQLite at `data/talk.sqlite`. Versioned SQL migrations run transactionally on startup, or explicitly with `npm run db:migrate`. Sessions expire after eight hours and survive server restarts. Keep the database private, back it up, and use durable storage when hosting. The dashboard's session/library content still uses the existing sample data.

Google setup and token verification follow the [official setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and [server verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Email verification and local testing

Use Node 22.17 or newer with `node:sqlite` available. Put the following values in the project root `.env` (next to `package.json`), preserving the existing Google configuration in `.env.local`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail-address@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM="Talk <your-gmail-address@gmail.com>"
```

Gmail requires an [App Password](https://support.google.com/mail/answer/185833), generated after enabling 2-Step Verification; use that instead of your normal Google password. The sender address should be your Gmail address or a Gmail-authorized alias. SMTP variables are backend-only. Never use a `VITE_` prefix or commit `.env` files. `.env.local` takes precedence over `.env`, and environment changes require restarting the dev server. Delivery requires STARTTLS on port 587 with certificate verification; SMTP logging is disabled.

From this folder:

```powershell
npm install
npm run db:migrate
npm run smtp:check
npm run dev
```

`smtp:check` checks STARTTLS and SMTP authentication without sending a message. It is **not** an inbox-delivery test. To test actual delivery and the complete flow:

The running backend also needs network access to `smtp.gmail.com:587`; a server started in a network-restricted environment cannot deliver email even with valid saved credentials. SMTP diagnostics print only a fixed failure category, never credentials or raw server responses. From a normal local PowerShell terminal, `& .\scripts\restart-talk-dev.ps1` safely replaces only the verified Talk Vite process on port 3001, reloads the existing `.env.local`, and leaves accounts and pending verification in the database. The optional `-TestEmailDelivery` flag sends one labelled sample email to the configured SMTP account. After restarting, refresh the browser with **Ctrl+F5** and choose **Resend OTP** to receive a working signup code. Failed resend attempts update the five-minute expiry and sixty-second cooldown without claiming delivery succeeded.

For an explicitly requested delivery-only test, `npm run smtp:test-send` sends one clearly labelled sample email to `SMTP_USER`. This uses the real SMTP transport, keeps the code and credentials out of logs, and does not create an account. The sample code cannot sign in; receiving a working signup code requires the browser flow below. SMTP acceptance still requires checking your inbox to confirm receipt.

1. Open http://localhost:3001/sign-up and enter your name, an email inbox you control, and a unique password of 8–128 characters. Choose **Sign Up**. Talk automatically opens the OTP verification page in the same tab. Sign out first if already signed in.
2. On http://localhost:3001/verify-email, enter the six-digit code from the Talk email in the six separate boxes, or paste the entire code into any box, then choose **Verify Email**. The first box receives focus automatically and typing moves to the next box. The email includes its exact expiry in India Standard Time. Successful verification marks the email verified, creates the secure session, shows **Email Verified Successfully**, and automatically opens the dashboard. If sending fails after verification has started, this page opens with a delivery error; wait for the resend countdown and request a new code. It never grants dashboard access before verification.
3. Refresh the dashboard, sign out, then log in at http://localhost:3001/sign-in with the same email/password. Email/password login is blocked until verification succeeds. If interrupted before verifying, sign in with your original credentials to resume verification; reload of the verification page also resumes its browser-bound challenge.
4. To check resend: wait for the 60-second countdown, choose **Resend OTP**, and use the newest email. The old code is immediately invalidated, including when delivery of the new email fails. **Back to Sign Up** invalidates the current challenge and returns to signup.
5. To check limits: five incorrect six-digit submissions lock that code; a new code is needed. Codes expire after five minutes, including older persisted codes issued under the previous ten-minute policy. Delivery is limited to five messages per email and thirty per IP per hour. Login is limited to ten attempts per email and forty per IP per fifteen minutes; verification adds twenty attempts per email and fifty per IP per ten minutes. Limits persist through restarts. Too many requests display a retry countdown; SMTP failures display a generic delivery error with retry instructions.
6. Check **Continue with Google** still works. Google and password accounts with the same email remain separate. To explicitly add password sign-in to a Google account, sign in with Google, open the dashboard account menu, choose **Add email sign-in**, choose a password, and verify the email code while keeping that same Google session. The session must be recent (under ten minutes); otherwise sign out and sign in with Google again. Existing password accounts are never merged or overwritten by this flow.

Passwords and codes are salted scrypt hashes; plaintext passwords, codes and Google ID tokens are never written to the database or logs. Verification codes are single-use and bound to a browser challenge; session identifiers are opaque HttpOnly/SameSite cookies, with Secure cookies on HTTPS. Signup responses are generic for both new and existing addresses; wrong-email/wrong-password login responses are identical. An already verified password account cannot be replaced through signup. Password reset is not implemented; its button explains this without pretending to send an email.

## Firebase phone sign-in

The signup and login pages include **Continue with Phone Number**. `/phone-sign-in` defaults to India (`+91`) and requests consent before sending a verification SMS through Firebase and reCAPTCHA. `/verify-phone` has six code boxes, paste support, **Verify OTP**, **Resend OTP**, and **Change Number**. A successful verification opens the existing Talk dashboard. The existing email OTP and Google flows are preserved.

The Firebase web configuration in `.env.local` uses `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and optional `VITE_FIREBASE_MEASUREMENT_ID`. These are public web-app settings. Set the backend's `FIREBASE_PROJECT_ID` to the same project (`talk-fc3dc`). Keep the existing SMTP and Google configuration. Restart the dev server after configuration changes; Vite also needs the public settings at build time.

Firebase proves ownership of the number; it does not replace Talk's authentication database. Before requesting an SMS, the frontend obtains a browser-bound Talk challenge with a sixty-second resend cooldown and persistent per-number/IP limits. The backend verifies the Firebase ID token's signature, issuer, audience, expiry, UID, phone provider/number, and recent authentication time before creating or finding the matching phone identity and issuing Talk's existing opaque HttpOnly session. A challenge is single-use and expires after ten minutes; Firebase may expire an SMS code sooner. Application rate limits supplement Firebase's own SMS quotas and abuse checks.

`server/firebase-auth.mjs` uses the Firebase Admin SDK with the expected project ID and Google's public signing certificates for signature verification. This integration does not need an Admin private key. It does **not** perform the credentialed Firebase user lookup for revoked tokens or disabled Firebase users. Disabling a Firebase user therefore does not immediately revoke an already issued Talk session; Talk's database session expiry and sign-out remain authoritative. See Firebase's [ID token verification documentation](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

The Firebase SDK uses in-memory persistence. Firebase ID/refresh tokens, verification IDs and OTPs are not saved in localStorage/sessionStorage or Talk's database/logs. The SDK signs out after the server exchange, while the Talk session continues. Reloading the OTP page loses the SDK confirmation; cooldown metadata can be recovered, then a new OTP must be requested. A temporary backend failure after Firebase verification offers **Complete sign-in** so the consumed SMS code does not have to be entered again. Leaving phone authentication, changing number, signing out or completing another sign-in clears the in-memory proof.

Phone accounts are never automatically merged with an email/Google account. To add phone sign-in to an existing account, sign in first, open the dashboard account menu and choose **Add phone sign-in**. The `/phone-sign-in?mode=link` flow requires that same confirmed, recently authenticated Talk session and a fresh verification of the number. A number already belonging to another account is rejected rather than merged. A phone-only account has no invented email address.

### Safe local test numbers

Use [Firebase's fictional phone-number workflow](https://firebase.google.com/docs/auth/web/phone-auth#test-with-fictional-phone-numbers) for local testing. It creates Firebase users and genuinely signed Firebase ID tokens without delivering SMS. Test codes are credentials: keep them private and change or remove them after testing.

1. In the Firebase console for `talk-fc3dc`, open **Authentication → Sign-in method → Phone → Phone numbers for testing**. Add a genuinely fictional, valid-format number and a private six-digit code. Do not add a real person's number as a test number.
2. Set `VITE_FIREBASE_PHONE_TESTING=true` in `.env.local` and restart `npm run dev`. This opt-in defaults to `false` and works only in Vite development on `localhost`, `127.0.0.1`, or IPv6 loopback. The page must show **Firebase test phone numbers only. No SMS is sent.** Firebase accepts configured test numbers in this mode; production builds and non-loopback hosts always keep normal reCAPTCHA verification enabled, regardless of the flag.
3. Open http://localhost:3001/phone-sign-in, enter the configured fictional number, accept the SMS consent and choose **Send OTP**. Enter the private console-configured code on `/verify-phone`, then choose **Verify OTP**. Check the dashboard, refresh, sign out and repeat to confirm the same account is used. Also try an incorrect code, wait for the resend countdown, and use **Change Number**.
4. For the opt-in live-Firebase browser check, privately set `FIREBASE_TEST_PHONE_NUMBER` and `FIREBASE_TEST_OTP` in `.env.local`, then run `node tests/firebase-phone-live-browser.mjs` with the dev server running on port 3001. These unprefixed values are test-runner inputs, never frontend configuration; do not prefix them with `VITE_`, print them, or commit them. For test numbers outside India or North America, also set the unprefixed `FIREBASE_TEST_COUNTRY_CODE`. The check uses an isolated browser session, creates or reuses the fictional number's account in Firebase and Talk's existing local database, signs out afterward, and reports only sanitized results. Run it only with a number/code explicitly configured under Firebase's **Phone numbers for testing**.
5. Turn off `VITE_FIREBASE_PHONE_TESTING` after local testing and restart the server. Real phone verification needs an authorized hosted domain, Firebase Phone Authentication, an allowed SMS region and the applicable Firebase SMS/billing quota. Firebase's current web-phone guide does not permit localhost as a hosted domain for real phone authentication. Use an authorized HTTPS deployment for real SMS rather than weakening production reCAPTCHA checks. No Firebase deployment is performed by these tests.

Keep these checks distinct:

- `tests/firebase-phone-server.test.mjs` and `tests/firebase-phone-browser.mjs` use injected token verification and a fixture Firebase SDK. They test Talk's flow/security without contacting Firebase or sending SMS.
- `tests/firebase-phone-live-browser.mjs` contacts the real Firebase project using the configured fictional number and code, then verifies the signed token through the real Talk backend. A passing result proves that integration path, not real SMS delivery.
- Real SMS delivery is confirmed only when an authorized real-number flow on an authorized HTTPS host sends a code and that SMS is received and successfully used. Neither fixture tests nor Firebase test-number success prove delivery.

### HTTPS testing deployment

Firebase Hosting frontend files and a guarded local build are prepared. Run `npm run hosting:prepare` to build without deploying. The live read-only check still returns HTTP 404 for the requested site; its domain is authorized and Firebase provides reCAPTCHA parameters. `npm run hosting:check` intentionally blocks publishing until the actual cloud backend, persistent storage, cookie forwarding and rate-limit behavior have been verified. See [the exact deployment and first real-SMS prerequisites](deployment/FIREBASE_HOSTING.md). Nothing has been deployed and no real SMS has been sent during this preparation.

Locally, `npm start` serves both the built frontend and existing Express API using SQLite and the current authentication cookies. Production backend support now uses PostgreSQL and an encrypted Hosting-compatible cookie, with a tested SQLite importer and separate Cloud Run/migration templates. Cloud resources and secrets have not been provisioned or deployed. See the deployment guide for approvals, Google OAuth origins and operator steps.

## Browser password saving

The email/password forms support browser autofill. After a successful verified password sign-in, Talk requests the browser's native **Save password** or **Update password** prompt using the [Credential Management API](https://web.dev/articles/security-credential-management-save-forms), where supported. Signup and explicit password linking request saving only after successful code verification. While awaiting that code, one native credential stays only in the current tab's memory for at most ten minutes, bound to the email and verification challenge. It is discarded when changing email, leaving verification, signing out, completing Google sign-in, or closing/reloading the page. No password is put in Talk's localStorage, sessionStorage, database plaintext, logs, or analytics. After a reload or interrupted signup, sign in with the verified email/password to request saving.

The browser decides whether to show a prompt, and the user chooses whether to save. Talk does not recreate a Chrome popup inside the page or ask to save a Google password. In Chrome, enable **Offer to save passwords and passkeys** at `chrome://password-manager/settings`; a site in the declined list or another password-manager setting can suppress the prompt. The address-saving popup is a separate browser feature. Password-manager refusal, unsupported browsers, and slow prompt decisions do not interrupt sign-in. Localhost is supported; deployed sites require HTTPS.

To check locally: open http://localhost:3001/sign-up, complete email verification in the same tab without reloading, and look for the browser's password prompt. Alternatively sign out and successfully sign in at http://localhost:3001/sign-in. Accept or decline in the browser. The automated helper and browser integration tests stub the native password manager; they verify when saving is requested and that errors do not block authentication, but do not prove a real browser popup appeared or save credentials to your browser.

`npm run test:auth` runs database/API security tests and mailer tests using isolated databases and captured/mock email delivery. These automated checks do **not** send SMTP mail. Actual delivery is confirmed only by receiving the email during the manual signup flow above. An SMTP connection success or message acceptance alone does not prove inbox delivery.

The header and footer use pale skin (`#faeee7`) without divider shadows, and share the webinar page's content gutters. The landing hero and final call to action have white backgrounds; the other sections retain the Stitch palette, typography, images, and composition. Images, fonts, and videos are served locally. Most feature previews use clips taken from the supplied recording; the webinar preview uses an original animated presentation, poll, and Q&A demo generated by `scripts/create-webinar-showcase.mjs`.

Camera and microphone access starts after a user clicks an enable button. The device check includes microphone levels, a speaker tone, and microphone recording/playback; tracks are stopped when leaving the screen. Meeting controls include an agenda, whiteboard drawing, screen sharing, chat, Q&A, and reactions.

The meeting stage plays original, silent animated social media marketing lessons. Selecting an agenda item switches to its matching lesson. `scripts/create-social-workshop-videos.mjs` generates the MP4s and posters locally.

The Product Onboarding and Interactive Webinars use-case cards play original sandbox and broadcast demos instead of static pictures. Their generators are `scripts/create-sandbox-showcase.mjs` and `scripts/create-broadcast-showcase.mjs`.

Registration, bookings, chat, and Q&A are local previews. They do not send email or connect other participants. The original event in the video is shown as a recorded event.

## Verify

```powershell
npm run lint
npm run build
npm run test:auth
npm run test:auth:passwords
# After building, with Chrome installed; real API and captured SMTP:
npm run test:auth:browser
npm run test:auth:otp-browser
# Real API/cookies, with fixture Google SDK/verifier (no Google account login):
npm run test:auth:google-browser
# Phone API security tests and fixture SDK browser flow (no Firebase/SMS):
node --test tests/firebase-phone-server.test.mjs
node tests/firebase-phone-browser.mjs
# Optional real Firebase with privately configured fictional test number; no SMS:
# node tests/firebase-phone-live-browser.mjs
# With the dev server running, and Chrome installed:
npm run test:browser
npm run test:visual
```

Browser tests use synthetic media devices, not the user's camera or microphone. Screenshots are written to `artifacts/qa/`.

The original Stitch files are kept in `references/stitch/`. `scripts/import-stitch.mjs` imports their markup and tokens without running the supplied scripts.
