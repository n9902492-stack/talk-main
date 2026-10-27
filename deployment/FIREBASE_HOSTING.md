# Talk Firebase Hosting preparation

For the current five-user/two-room scope and costs, start with [TEAM_TESTING.md](TEAM_TESTING.md). The historical SMS-only proposal below is retained as implementation history. No deployment is authorized by either document.

Prepared locally on 15 October 2026. **Nothing has been deployed and no real SMS has been requested.** Website components and design are unchanged. SQLite remains the development store. Production now supports PostgreSQL with the same authentication APIs and a Hosting-compatible encrypted cookie.

Start with [APPROVAL.md](APPROVAL.md) for the beginner sign-in step, read-only cloud inspection, proposed resources/costs and separate approval boundaries. `cloudsql.instance.json` is an unapplied database proposal. The Cloud Run template explicitly scales to zero with a two-instance maximum. These files do not create resources by themselves.

After account sign-in, [LIVE_READINESS.md](LIVE_READINESS.md) records the 15 October read-only project inspection, confirmed Firebase settings, disabled deployment APIs and current pricing estimate. No deployment flags were marked complete.

## What was verified

| Check | Result |
| --- | --- |
| `https://talk-fc3dc.web.app` | HTTP 404; Talk is not deployed there |
| Public Firebase project configuration | `talk-fc3dc.web.app` is an authorized domain |
| Firebase reCAPTCHA parameters | HTTP 200 with a provisioned site key; the key was not printed |
| Production SDK initialization | Normal Firebase app verification remains enabled even if the testing flag is accidentally true |
| Development fictional numbers | The existing opt-in loopback test mode is preserved |
| Production build | Built locally into `frontend/dist`; private configuration markers checked |

Authenticated inspection now confirms Phone Authentication enabled, India explicitly allowed, the Hosting domain authorized and linked billing enabled. The owner confirmed a current ₹28,797 credit balance in the console. Trial expiry and the previously reported 1,000/day Firebase product SMS cap remain unverified through these APIs; the generic API request quota must not be treated as an SMS allowance. No privileged project configuration was changed. A reCAPTCHA site key being available does **not** prove a completed browser challenge or delivered SMS on the final HTTPS deployment.

## Files and safe local commands

- `firebase.json` targets only `frontend/dist`, preserves the Google popup-compatible opener policy, reserves `/api` for a backend before the SPA fallback, and runs a deployment preflight.
- `.firebaserc` selects `talk-fc3dc`.
- `.env.production` explicitly sets `VITE_FIREBASE_PHONE_TESTING=false`. Development continues to read the existing local test setting. Keep the production flag false in CI too. All required public Firebase build values are already present locally; a future build machine needs the same `VITE_FIREBASE_*` values. Never copy SMTP credentials or test inputs into `VITE_` settings.
- `deployment/hosting-readiness.json` distinguishes passing local implementation checks from hosted infrastructure checks. The deployment flags remain false until the actual cloud resources and hosted smoke tests have been verified.

Run from the cloned repository root (the folder containing `frontend/`, `backend/` and `package.json`):

```powershell
npm run hosting:prepare  # Local production build and frontend checks only
npm run test:hosting     # Configuration/production-mode tests; SDK fixture, no SMS
npm run hosting:inspect  # Read-only HTTPS GET checks; no deploy or OTP request
npm run hosting:check    # Intentionally fails until the backend is ready
```

The inspection scripts never invoke a deployment or request a verification code. `hosting:inspect` returns a nonzero status for the current missing site. Google Cloud account sign-in and authenticated metadata access have now been checked; deployment permissions and disabled product services still need review/approval. Local Docker was used only for isolated PostgreSQL tests and the backend image build. The final image built successfully and remains local; no registry push occurred. An offline image test also passed migrations, real startup, database health, encrypted challenge handling and persistence across an app restart. Image inspection confirmed non-root execution and absence of private environment files/user data.

## Backend implementation and local verification

- Existing email, Google and Firebase phone handlers now await database operations. SQLite remains available for development; production requires PostgreSQL and will not silently fall back to temporary SQLite.
- PostgreSQL migrations are in `backend/src/postgres-migrations`. Account IDs, password hashes, sessions, verification challenges, rate limits and phone identities are stored together. Per-request connections, transactions, identity locks and bound-session locks protect concurrent verification/linking.
- `backend/src/hosting-cookies.mjs` packs the existing opaque cookie values into one authenticated AES-256-GCM `__session` envelope. It is Secure, HttpOnly, SameSite=Lax, host-only, scoped to `/api/auth`, and bound to the application origin. Each inner value keeps its own expiry. No password, OTP or Firebase ID token is stored in it. Existing database sessions still govern expiry/logout.
- Persist the cookie encryption key in Secret Manager across restarts/instances. `AUTH_COOKIE_SECRET_PREVIOUS` supports rotation; retain the old key during the chosen grace period (up to 24 hours for pending verification cookies). Losing/replacing both keys requires users to sign in again.
- Trusted proxy handling walks the address chain from the connection toward the first untrusted hop. Trust-all is rejected. The template trusts only loopback/link-local ingress addresses; confirm the actual Firebase Hosting/Cloud Run chain before release. If a further Google proxy appears as that first untrusted address, users may share a conservative IP bucket until the exact trusted ranges are configured. Do not blindly trust the leftmost forwarding header.
- Production binds to `0.0.0.0:$PORT`, requires HTTPS, reports database readiness at `/healthz`, and suppresses credential-bearing startup/driver/SMTP error details. It does not load local environment files in production.
- No frontend component, layout, wording or theme was changed. Google still uses its existing GIS popup/ID-token flow. Firebase phone tokens are still verified by the existing Admin verifier before a Talk session is issued.

Local validation commands:

```powershell
npm run test:auth                 # Existing API/mailer tests, isolated SQLite
npm run test:auth:production      # Real local PostgreSQL 16 in a disposable Docker container
npm run test:auth:hosting-browser # Browser + real API/cookies, simulated HTTPS Hosting proxy
npm run test:hosting              # Production phone/reCAPTCHA guard checks
node scripts/test-backend-image.mjs --auth-tests # Offline image: 12 auth tests plus startup/restart
npm run lint
npm run hosting:prepare
```

The production-preparation baseline passed 62 backend/mailer tests, 12 real-PostgreSQL production tests, 8 Hosting/production-mode checks, 20 password-manager unit tests, browser regressions, lint and the frontend build. The workspace reorganization preserves frontend source content; build output and tool paths now use `frontend/dist/` and `backend/src/`.

If Docker Desktop port forwarding is unavailable, use the offline image command above after building `talk-auth:local-check`; it runs the same 12 authentication tests inside the production image without exposing a database port. The PostgreSQL suite tests five-attempt limits, expiry, resend invalidation/cooldown, unverified-login blocking, one-session concurrent verification, persistence after pool restart, Google confirmation/separate accounts, returning phone login, and atomic SQLite import. The browser proxy forwards only `__session`. Google/Firebase credential verification and email delivery are fixtures in these regressions; they do not prove real Google login, Cloud SQL connectivity, SMTP delivery, hosted reCAPTCHA completion or real SMS delivery. The previously completed Firebase fictional-number flow remains a separate test.

## Prepared files and private settings

- `backend/Dockerfile` / `.dockerignore` / `.gcloudignore`: backend image and upload exclusions. Build from the repository root with `docker build -f backend/Dockerfile -t talk-auth:local-check .`. The allowlist contains backend code, its Dockerfile and the root/workspace package manifests. Only backend runtime dependencies are installed in the image; environment files, user databases, test artifacts, reference assets and frontend build output are excluded. Firebase Hosting separately publishes `frontend/dist/`.
- `deployment/cloudrun.service.yaml`: proposed `talk-auth` service in `asia-south1`, two-instance cap, five database connections per instance, dedicated service account and Secret Manager references. Replace `RELEASE_TAG` with the reviewed image digest/tag after approval; do not apply the template now.
- `deployment/cloudrun.migration-job.yaml`: separate schema-migration job, with database-owner credentials and no SMTP secrets. It does not import users automatically.
- `deployment/cloudbuild.yaml`: optional Cloud Build template selecting `backend/Dockerfile` with the repository root as context. After build/upload approval, supply a reviewed full registry URI through `_IMAGE`; the default placeholder intentionally is not a usable image name. Do not use automatic root-Dockerfile detection for this workspace layout. The template builds and uploads an image; it does not deploy Cloud Run or Firebase Hosting.
- `deployment/postgres-grants.sql`: grants for a separate non-superuser runtime role after migration.
- `deployment/backend.env.example`: backend-only settings. `npm run backend:prepare-env` created `.env.backend.production.local` privately, copied the existing local SMTP/Google configuration, and generated a cookie key. Values were not printed. Re-running leaves that private file unchanged. Proposed runtime and migration-owner database passwords were generated in separate private files; no remote database user or secret was created.
- `npm run backend:check` validates that private configuration without connecting to any service. It now passes local configuration validation; this does not connect to or prove the existence of Cloud SQL. The separate migration-owner file is `.env.backend.migration.local` and must never be provided to the app runtime.

## Exact manual setup and approvals before deployment

**These cloud operations have not been performed.** The service name in `firebase.json` is the proposed `talk-auth`; it is not an existing deployed backend.

1. Approve creation/use of the billable infrastructure in project `talk-fc3dc`: a Cloud SQL PostgreSQL 16+ instance `talk-auth-db` in `asia-south1`, database `talk_auth`, Artifact Registry repository `talk`, Secret Manager secrets, and the Cloud Run service/job. Choose the database tier/HA and cost limits before creation. Enable automated backups, point-in-time recovery and deletion protection; perform a backup/restore check. Cloud SQL is durable storage independent of Cloud Run instances. No price or trial-credit coverage is assumed.
2. Authenticate the Firebase and gcloud CLIs with project access. Enable the required Cloud SQL Admin, Cloud Run, Artifact Registry, Cloud Build and Secret Manager APIs after provisioning approval. Create a dedicated runtime service account and a separate migration-job account. Grant Cloud SQL Client to each, and Secret Accessor only on the individual secrets each needs; the build account does not need SMTP or cookie secrets.
3. Create a database owner/migration role `talk_auth_migrator` and a non-superuser runtime role `talk_auth`. Set their passwords privately; the app runtime must not be a database administrator. Use the proposed passwords in the separate private preparation files when creating those database users, then pass `npm run backend:check`. Upload values through Secret Manager without putting them in commands, logs, frontend variables or source files. The service template maps `talk-db-password`, `talk-cookie-key`, `talk-smtp-user`, `talk-smtp-password`, and `talk-smtp-from`; the migration job additionally uses `talk-db-migrator-password`. Existing Gmail App Password/SMTP configuration is reused. Pin reviewed secret versions in the templates.
4. Approve image build/upload, database schema migration and any account-data import separately from making the site public. Build the reviewed backend image and set its tag/digest in both templates. Run the migration job (entry point `node backend/src/migrate-production.mjs`), then apply `postgres-grants.sql` as the owner. The runtime intentionally does not run DDL or auto-migrate production at startup.
5. To preserve existing local accounts, first pause signup/authentication writes, take a consistent protected SQLite backup, and review the target database. From a trusted operator environment with owner credentials, set `SQLITE_IMPORT_PATH` to the backup's absolute path and run `node backend/src/import-sqlite.mjs --confirm-empty-target` from the repository root. Absolute paths also work with the backend npm workspace, whose working directory is `backend/`. The importer refuses any nonempty target and copies all authentication tables in one transaction without logging row contents. It preserves IDs and hashes. Back up the target afterward. Localhost cookies do not transfer to the HTTPS domain; users sign in again there. Do not perform the import until you approve copying that user data to the cloud.
6. In **Google Cloud Console > Google Auth Platform / APIs & Services > Credentials > existing OAuth Web Client**, add **`https://talk-fc3dc.web.app`** under **Authorized JavaScript origins**. Keep the existing localhost origins. Do not include a path or trailing callback route. Current GIS uses `ux_mode: popup` with a JavaScript credential callback, followed by Talk's same-origin `POST /api/auth/google`; **no new authorized redirect URI is required** for this implementation. Do not add a made-up OAuth callback or switch to Firebase Google login. Keep any unrelated existing redirect URIs. Check the consent-screen branding/status/test-user access if Google requires it. Firebase authorized domains and Google OAuth origins are separate settings.
7. Approve deployment of the backend revision and then Firebase Hosting. Firebase Hosting rewrites need an invokable Cloud Run service: approve the public invocation policy for the service (Cloud Run Invoker for `allUsers`, or the organization-approved equivalent). Application sessions, verification and CSRF are still enforced by Talk; public invocation does not grant dashboard access. The backend must use `APP_URL=https://talk-fc3dc.web.app`, the mounted Cloud SQL connection, and the reviewed secrets. First verify the deployed database health of the backend, actual proxy boundary, cookie protocol and persistence across revision restart, using a private preview/proxy plus the regression harness where needed. Record the verified infrastructure checks in `hosting-readiness.json`, pass `npm run hosting:check`, then publish Hosting only after approval. Once Hosting is live, perform final email/Google/fictional-phone HTTPS checks and verify the real browser reCAPTCHA. Real SMS is a later, separately approved action. Do not mark cloud checks complete solely because local unit tests passed.

For the backend/Hosting order, the final Hosting predeploy gate remains blocked until the real backend/storage/proxy conditions are verified. No deploy command or provisioning command is run by the preparation scripts. Production secrets belong exclusively on the backend. See [Cloud SQL connections from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run), [Hosting cookie restrictions](https://firebase.google.com/docs/hosting/manage-cache#using_cookies), and [Google OAuth client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Required before the first real SMS test

Live meeting release also requires the Phase 3 PostgreSQL migration/runtime grants and a separately approved WebSocket-capable backend URL in `MEETING_SIGNAL_URL`; Hosting HTTP rewrites are not used as the signaling endpoint. This does not change Email OTP, Google or Firebase phone authentication. See [PHASE3_MEETINGS.md](PHASE3_MEETINGS.md). No deployment or SMS is authorized by these preparation steps.

1. Approve deployment separately. Deploy the prepared frontend **and working authentication backend**, then confirm that the landing page, `/phone-sign-in` and authentication APIs work on HTTPS. Verify that normal reCAPTCHA renders there without a testing banner. Loading/solving reCAPTCHA does not itself send an SMS.
2. Keep the fictional numbers for development. Ensure your personal `+91` number is **not** listed under Firebase's **Phone numbers for testing**. A console-configured test number still uses its fixed test code and receives no SMS, including in production. Remove only your personal number from that test list if necessary; retain the fictional numbers.
3. The Phone provider, India allowlisting and linked billing were verified live. Reconfirm the current Firebase product daily SMS cap in the console before a real send. That cap is a sending limit, **not** a guarantee of free messages. Review current [Firebase pricing](https://firebase.google.com/pricing) and your credits/billing before authorizing a send; no charge estimate was inferred from the quota.
4. Explicitly approve **one real SMS request**. Only then enter your own number on the hosted phone page, accept consent, complete reCAPTCHA and choose **Send OTP**. Do not publish the number, received code or tokens in chat/logs. Enter the received code in the six boxes, verify, check the dashboard, refresh and sign out. Do not automatically resend; Talk's sixty-second cooldown and per-number/IP limits still apply.
5. Confirm actual receipt and successful verification. The earlier real-Firebase fictional-number checks and current SDK-fixture tests do not prove real SMS delivery.

Firebase provisions reCAPTCHA keys through `RecaptchaVerifier`; no separate manually created reCAPTCHA secret is needed. The SDK still calls `signInWithPhoneNumber` and `confirmation.confirm`, and Talk verifies the signed Firebase ID token before issuing its own session. Production has no fixed OTP fallback. See [Firebase web phone authentication](https://firebase.google.com/docs/auth/web/phone-auth).
