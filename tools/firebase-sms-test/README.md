# Temporary Firebase SMS delivery test

This page tests **one real Firebase SMS and Firebase code verification only**. It uses the existing Firebase project `talk-fc3dc`, the installed Web SDK, and Firebase Hosting. It needs **no Talk backend, Cloud SQL, Cloud Run, Cloud Build, Artifact Registry or Secret Manager**. No existing Talk page, route, design, email flow, Google flow or backend authentication code was changed.

**Prepared locally; not deployed; no real SMS sent.** Hosting deployment, one SMS request and eventual removal each require explicit approval.

## What is prepared

- A small standalone page with a +91 input, visible normal reCAPTCHA, consent, **Send ONE SMS**, OTP input and **Verify OTP**.
- Named Firebase app, in-memory authentication, normal app verification enabled, immediate sign-out after success. No analytics, account linking, Talk session or dashboard redirect.
- No automatic send, retry or resend. A persistent run-scoped browser flag is written **before** the SDK request, with Web Locks to prevent simultaneous requests from same-origin tabs. Reloading or a delivery error does not unlock sending.
- Five local verification attempts; incorrect/expired-code, quota, domain, billing and network messages are sanitized. Firebase also enforces its own limits/expiry. No phone, code or token is written to application storage/logs.
- Random unlisted path, no indexing, no referrers, no-store responses, restrictive CSP and no iframe embedding. The random path is not access control. Public Web configuration is expected; SMTP/Admin credentials/test codes are not bundled.

**Limit:** client locks cannot enforce a project-wide one-SMS maximum. Another browser, cleared storage or modified code can bypass them. Keep this publishing window short and remove the page after the test. Do not clear storage or rotate the run ID to retry without new approval. A network error can occur after Firebase accepted the send; wait/check the phone instead of retrying.

Firebase verification may create a Firebase Authentication phone user or sign into an existing one. Signing out clears this page's session but **does not delete that user record**. No Talk account/session is created. This proves phone delivery/verification, not the complete Talk production login flow. Do not delete an existing Firebase user automatically.

## Hosting safety

On **15 October 2026**, authenticated GETs returned an empty `live` release list and no active release for `talk-fc3dc`. The public root returned 404. The existing authorized hostname can therefore host this isolated test without replacing a published Talk website **at the time checked**.

Firebase Hosting deploys a **whole release**: a `/sms-test.../` directory and alternate config do not merge with existing files. The deployment pre-hook repeats the read-only release check and refuses any existing live release or uncertain API response. Recheck immediately before publishing and avoid concurrent deployments. Never bypass this guard if Talk is later published.

If the site is no longer empty, use a separately approved preview channel/site and separately authorize its generated hostname for Firebase Auth. Do not overwrite Talk. Root `firebase.json` and its production readiness gate are unchanged; this separate configuration is solely for a page with no backend.

## Exact steps

Run local preparation from the repository root (already completed by Codex):

```powershell
npm run sms-test:build
npm run sms-test:check
npm run sms-test:hosting-status
npm run test:sms-test
node --test tests/sms-test-hosting-guard.test.mjs
```

These commands build locally, use isolated provider fixtures, or perform GET-only Hosting inspection. They do not deploy or send SMS. The build reuses its random identifier from ignored `artifacts/qa/sms-test-run.json`; it does not silently reset the browser send lock. The prepared HTTPS URL is printed by `sms-test:check`, but is not live yet.

### Approval 1: deploy only this temporary page

After you explicitly approve the temporary Hosting deployment, Codex will:

1. Recheck that the current live site has no releases and that the separate build has only test files. Check that the Phone provider, India policy and authorized domain remain correct. No extra cloud services need enabling.
2. Use the installed Firebase CLI. The existing Google Cloud CLI sign-in may not also sign into Firebase CLI; if needed, complete the official Firebase CLI login in your own browser. Never paste credentials or tokens into chat.
3. Execute this command **only after deployment approval**, from the repository root:

```powershell
node .\artifacts\qa\firebase-cli\node_modules\firebase-tools\lib\bin\firebase.js deploy --project talk-fc3dc --only hosting --config .\tools\firebase-sms-test\firebase.json --message "Temporary Talk SMS delivery test"
```

The config publishes only `tools/firebase-sms-test/dist`. It has no backend rewrites, functions or database settings. Its predeploy command is relative to that config's project directory. No `firebase init`, provider changes, full Talk deployment or database creation is needed. Codex will record the resulting release/version for removal review and give you the actual HTTPS URL.

4. Open the page to check configuration and reCAPTCHA loading. **Opening the page does not request an SMS. Do not press Send yet.** Any real challenge is completed by you in your browser.

### Approval 2: request exactly one real SMS

Before approving the send, save your personal E.164 number privately in root `.env.local` as `REAL_SMS_PHONE_NUMBER=+91...` if you want Codex to compare it safely with Firebase's fictional list. `npm run cloud:inspect` prints only whether the number is fictional. Do not prefix this setting with `VITE_`, bundle it or paste the number/code into chat. If the number is fictional, removing only that entry is a separate configuration change requiring approval; preserve other development numbers.

Confirm the current Firebase daily product SMS cap and billing eligibility. The earlier generic API quota is not an SMS allowance. Once you separately approve **ONE** real SMS:

1. Enter your personal 10-digit number on the HTTPS page and read/check the consent. Google receives the number for verification and abuse prevention.
2. Complete reCAPTCHA and click **Send ONE SMS** once. Codex will not automate this request or solve the challenge.
3. Enter the received code only in the page and click **Verify OTP**. Do not share it in chat or logs.
4. Success clears the temporary Firebase session. Record whether the message was actually received and verified; an accepted send request alone is not a delivery result.
5. If delivery fails, do not retry or clear storage. Investigate the sanitized error; any additional SMS requires new approval.

### Approval 3: remove the temporary page

After you approve removal, Codex will verify that the active release contains **exactly** the known temporary file paths and no SPA/backend routing. If Talk or other files have appeared, stop and preserve that release. With the cleanup guard passing, this separate command replaces only the standalone test release with 404/robots files:

```powershell
node .\artifacts\qa\firebase-cli\node_modules\firebase-tools\lib\bin\firebase.js deploy --project talk-fc3dc --only hosting --config .\tools\firebase-sms-test\firebase.cleanup.json --message "Remove approved temporary SMS test"
```

The cleanup command is **not** authorized yet. Its guard fails closed if the live files no longer match the test. Do not use `hosting:disable` on a site that may contain Talk. Removing old retained Hosting versions or a Firebase Auth user is a separate reviewed deletion; neither is automatic.

## Expected costs

- **No Cloud SQL or other backend infrastructure cost** for this standalone test. The earlier approximately ₹1,100/month database proposal is unnecessary for this immediate delivery check.
- India verification SMS currently lists **US$0.07 per message**, with the first ten SMS/day unbilled under the published table. A conservative one-message allowance is about **₹7 before tax**, using the current catalog conversion estimate; actual project usage, INR SKUs, billing rules and credit eligibility determine the charge. Do not guarantee zero cost from your credit balance or quota.
- The built test is approximately **112 KB uncompressed**. Hosting has no-cost storage/transfer allowances; a few page loads should fit unused allowance. Beyond that, published rates are US$0.026/GB-month stored and US$0.15/GB transferred. Existing project usage and retained versions count. Keep the window short and remove the page after approval.
- No paid infrastructure is provisioned by these local preparation commands. Trial balance ₹28,797 was confirmed by you; expiry/credit applicability still govern usage. Budget alerts are not spending caps.

Sources: [Firebase Web Phone Auth](https://firebase.google.com/docs/auth/web/phone-auth), [SMS prices](https://cloud.google.com/identity-platform/pricing), [Hosting usage/prices](https://firebase.google.com/docs/hosting/usage-quotas-pricing), [Hosting deployment behavior](https://firebase.google.com/docs/hosting/test-preview-deploy), [Hosting release metadata](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/list).

## Test evidence

Automated checks use an offline Firebase/reCAPTCHA fixture and intercepted browser traffic. They exercise the real page's consent/captcha guards, request locking, correct/wrong/expired-code states, sign-out and layout. They cannot prove real SMS receipt, a real browser challenge, actual Firebase code verification or deployed CSP compatibility. Those remain explicitly approved live checks. The build and metadata inspection are separate from deployment.
