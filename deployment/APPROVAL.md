# Talk deployment approval

The current five-person/two-meeting proposal is [TEAM_TESTING.md](TEAM_TESTING.md), including updated costs, LiveKit choices and recording estimates. The SMS-only proposal below is historical; approval has not been granted for either deployment.

Checked on 15 October 2026. **No resources created, no deployment, and no real email or SMS requested.** Website design and authentication flows are unchanged.

Update after Google Cloud sign-in: see [LIVE_READINESS.md](LIVE_READINESS.md) for live settings, service states and the roughly **₹1,100/month database baseline**. The owner confirmed a current ₹28,797 trial balance in the console. The historical sign-in instructions below remain useful on another computer; sign-in has now succeeded in this workspace.

## Ready locally

- Firebase Hosting publishes only `frontend/dist`, with `/api` routed to the proposed `talk-auth` Cloud Run backend in Mumbai (`asia-south1`).
- The existing backend supports PostgreSQL accounts/sessions, persistent verification attempts/rate limits, and secure encrypted Firebase Hosting cookies. Backend settings are prepared privately, reusing existing Gmail SMTP and Google configuration.
- Production Firebase app verification/reCAPTCHA stays enabled. Fixed fictional test inputs are not bundled; opt-in development testing remains available. A number listed as fictional in Firebase still receives no real SMS on any host.
- The deployment gate remains blocked until actual cloud storage, proxy handling, cookies and authentication checks pass. Local tests cannot satisfy these cloud checks.

## Still unverified

The public site returns **404**. Public Firebase endpoints confirm the Hosting domain is authorized and a reCAPTCHA site key is provisioned. This does not prove browser challenge completion or delivered SMS.

Google Cloud account access is now connected. Billing is enabled; the billing account is open and uses INR. Phone Authentication, India allowlisting and the Hosting authorized domain were verified live. One fictional test number matches local development settings. The personal-number comparison, actual Firebase product daily SMS cap, trial expiry and Google OAuth HTTPS origins remain unverified. See the live report before proceeding; no missing-resource conclusion is inferred merely from lack of API access.

## Sign-in command for another computer

Run in the VS Code terminal at this repository's root:

```powershell
npm run cloud:login
```

Sign in in your own browser with the Google account that owns `talk-fc3dc`. This is already complete in the current workspace. It only connects the local CLI; it does not deploy or create resources. Credentials remain in ignored `artifacts/qa/gcloud-config`. Never share passwords, authorization codes, tokens or OTPs in chat.

The local helper uses the official Google Cloud CLI under `artifacts/qa/cloud-tools/google-cloud-sdk`. On another Windows computer, install the [official CLI](https://docs.cloud.google.com/sdk/docs/install-sdk) and set `GCLOUD_SDK_ROOT` to its SDK folder; Unix uses `gcloud` from PATH. Firebase CLI is installed separately under ignored `artifacts/qa/firebase-cli`. Neither tool is included in the deployed application.

After sign-in, `npm run cloud:inspect` performs fixed **metadata GETs only**, printing status/boolean summaries. It never enables APIs, accesses secret payloads, changes billing, provisions, deploys or sends messages. Tokens and Firebase fictional codes are not printed. A 403 stays **unverified**. The script does not change release-readiness flags or certify a real authentication flow.

Optionally save `REAL_SMS_PHONE_NUMBER=+91...` privately in root `.env.local` to compare your intended personal number with Firebase's fictional-number list. The inspector prints only the comparison result. Until both a valid number and privileged Firebase config are available, this remains unverified. Keep fictional development numbers; remove your own number from that list only with approval if necessary.

## Proposed pilot resources, after approval only

| Resource | Proposal |
| --- | --- |
| Firebase Hosting | Existing `talk-fc3dc` site, managed HTTPS, same-origin API |
| Cloud Run | `talk-auth`, Mumbai, 1 CPU / 1 GiB, minimum 0 / maximum 2 instances, request-based CPU, concurrency 20 |
| Cloud SQL | `talk-auth-db`, PostgreSQL 16 Enterprise, `db-f1-micro`, single zone, 10 GiB SSD, auto-growth capped at 20 GiB |
| Database protection | Daily backups (7 retained), 7-day PITR, deletion protection, authenticated connectors required, no authorized public networks |
| Database roles | Separate migration owner `talk_auth_migrator` and restricted runtime `talk_auth` |
| Migration job | `talk-auth-migrate`, explicit execution, no automatic retry |
| Artifact Registry / Cloud Build | Regional Docker repository `talk`, reviewed backend image build |
| Secret Manager | Six existing secret names from service/job templates; backend credentials only |
| Service accounts | Separate runtime/migrator, scoped SQL and secret access, reviewed build identity |

`cloudsql.instance.json` is an **unapplied proposal**, with no password. Its public IPv4 endpoint requires the authenticated Cloud SQL connector; ordinary public-network access is not allowed. This small shared-core, single-zone pilot has no HA failover and is not a commercial-launch capacity/SLA recommendation. Check regional availability and the live quote before creation. Reuse suitable existing resources after review instead of duplicating them. See the [official Cloud SQL instance API](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1/instances).

## Costs before approval

No spend is authorized. The signed-in public catalog returned the exact Mumbai machine rate; storage/backups and the combined roughly ₹1,100/month baseline are estimates described in the live report. Review remaining credit eligibility and expiry before resource approval.

- **Cloud SQL costs money while running**, including when Talk is idle. The current estimated machine plus 10 GiB disk baseline is about ₹1,100/month; storage/backups/networking and taxes can add charges. See the [regional pricing/calculator](https://cloud.google.com/sql/pricing) and live report; this is not a total spending cap.
- Cloud Run requests, builds/image storage, secret access, Hosting storage/downloads and logs may cost money above allowances. Existing large video assets count toward Hosting transfer. Instance/storage limits do not cap all charges.
- The current [SMS table](https://cloud.google.com/identity-platform/pricing) lists **US$0.07 per India SMS**, with the first ten SMS/day not billed. Actual currency SKUs, project usage and applicable rules determine charges. A 1,000/day quota is not a free allowance or delivery guarantee.
- You confirmed ₹28,797 remaining in Billing > Credits during the live inspection. This promotional balance is not exposed by the read-only billing API; expiry remains unverified. [Trial-credit eligibility/expiry](https://docs.cloud.google.com/free/docs/free-cloud-features) apply; do not assume every service or SMS is covered.
- Agree a budget alert before creation. Alerts notify; they **do not stop spending**. Review costs and retention after the pilot. Stopping compute can leave storage charges; deleting durable data requires separate approval. Monitor the disk-growth cap to avoid an outage.

## Separate approvals

1. **Infrastructure:** exact cost quote, API enablement, resource creation/reuse, IAM policies and six secret uploads. No implicit billing-plan changes or broad runtime owner permissions.
2. **Release/data:** image build/upload, migrations/grants, optional protected import of existing local accounts only if approved, backend deployment/public invocation, and Firebase Hosting publication. Talk sessions/verification/CSRF/rate limits still protect publicly invokable API endpoints. Keep the final readiness gate.
3. **One real SMS:** only after HTTPS deployment and hosted checks succeed, one request to your own confirmed non-fictional number. No automatic retries/resends. Enter the received code only on Talk, never in chat. Any second message needs another decision.

Before publication, add `https://talk-fc3dc.web.app` under **Authorized JavaScript origins** of the existing Google OAuth Web Client in Google Cloud Console; keep localhost origins. The current popup/JavaScript callback requires **no new redirect URI**. This is separate from Firebase's authorized domains. Codex will guide this manual step if supported tools cannot perform it.

Actual Cloud SQL connectivity, migrations/grants, proxy boundaries, restart persistence, hosted Email OTP/Google/fictional-phone checks and browser reCAPTCHA remain to be verified. Automated provider/mail fixtures do not prove delivery. See [FIREBASE_HOSTING.md](FIREBASE_HOSTING.md) for release order, secure import and recovery steps.

## Validation from this preparation pass

- Authentication, mailer, production-cookie, Hosting and cloud-inspection tests: **77 passed, 0 failed**. The database integration group was skipped in that direct invocation and run separately using the offline production image.
- Offline production-image suite with real PostgreSQL: **12 passed, 0 failed**, plus actual migrations, startup, database health and persistence after app restart. No SMTP/SMS/cloud network was available.
- Built-site Hosting browser regression: signup, Email OTP, password login, Google confirmation, encrypted secure cookie, refresh/logout and dashboard guard passed with mail/Google fixtures.
- Phone browser regression: entry pages, consent/reCAPTCHA fixture, six-box OTP interaction, incorrect/expired codes, resend/change-number, proof rejection, session/dashboard and responsive checks passed with an isolated Firebase SDK fixture. Its first concurrent run failed at the initial page; an isolated rerun passed without application changes.
- Lint, production build, private production configuration validation and new-script syntax checks passed. Existing private backend settings match the saved local SMTP/Google settings. No configured private credentials were found in the changed deployment files.
- Both official CLIs are prepared locally; Google Cloud core version 589.0.0 and Firebase CLI 15.34.0 were checked. The Google archive SHA256 was verified against the official download page. Unused `gsutil` was excluded from the successful core extraction because Windows could not create some of its documentation symlinks.
- `hosting:check` still fails on the four intentionally unverified **cloud** checks. These flags were left false. No actual SMTP delivery, real Google login, hosted reCAPTCHA completion or real SMS delivery was tested in this pass.
