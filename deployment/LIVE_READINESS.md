# Talk live cloud inspection

Read-only inspection on **15 October 2026**, project **talk-fc3dc**. No APIs enabled, cloud resources created, secrets uploaded, deployment performed, email sent or SMS requested. Website design and authentication flows were not changed.

## Confirmed live

| Check | Result |
| --- | --- |
| Google Cloud project | Active; signed-in account can read project metadata |
| Linked Cloud Billing | Enabled; account open; currency INR |
| Trial balance | **₹28,797**, confirmed by the owner in Billing > Credits during this inspection; not exposed by the read-only billing API |
| Trial expiry | Not provided/independently verified |
| Firebase project | Active; Hosting site configured |
| Firebase Phone provider | Enabled |
| India SMS region policy | Explicitly allowed |
| `talk-fc3dc.web.app` authorized domain | Present |
| Public reCAPTCHA parameters | HTTP 200; provisioned site key present |
| Fictional numbers | One configured; matches the saved local development test number. No number/code printed |
| Personal-number fictional status | Unverified: `REAL_SMS_PHONE_NUMBER` is not saved. The fictional development number must not be used for a real SMS test |
| Public Talk URL | HTTP 404; Talk is not published there |
| Cloud SQL resources | An authenticated instance-list read returned no instances; SQL Admin API is disabled in the target project |

The standard Firebase web reCAPTCHA flow is preserved, and the production build cannot enable its development bypass. A returned site key is not proof that a hosted browser challenge or real SMS works. There is no fixed-code fallback in production. A console-configured fictional number still receives no SMS even on a production site.

## SMS quotas: request limit versus sending limit

Both live **Service Usage** and **Cloud Quotas** reads reported an effective **4,000,000 Send Verification Code API requests/project/day**. This is a general API request quota, **not four million available SMS messages**. It does not confirm remaining SMS allowance, Firebase's product-specific daily cap or abuse/carrier restrictions.

Monitoring returned no sent/blocked/verified SMS time-series observations for the previous seven days. Missing observations are not proof of zero usage or of an unused free allowance.

The earlier owner-reported **1,000 SMS/day** Firebase limit has not been independently re-confirmed through these APIs. Check the current Firebase console daily SMS limit before authorizing a real send. General [Firebase Auth limits](https://firebase.google.com/docs/auth/limits) and [Identity Platform quotas](https://docs.cloud.google.com/identity-platform/quotas) must not be substituted for this project's product-specific limit.

## Required services

Live Service Usage GETs checked the **target project's** state:

| Service | State |
| --- | --- |
| Firebase Management | Enabled |
| Identity Toolkit | Enabled |
| Service Usage | Enabled |
| Cloud Run | **Disabled** |
| Cloud SQL Admin | **Disabled** |
| Artifact Registry | **Disabled** |
| Cloud Build | **Disabled** |
| Secret Manager | **Disabled** |

The five disabled deployment services require approval before enablement. Disabled product APIs prevent checking every proposed backend resource; they do not justify claiming that all resource names are unused. Existing suitable resources must be reviewed/reused when accessible.

Cloud Billing API, Billing Budgets API and Cloud Quotas API are also disabled **inside the application project**. The existing billing-link/account metadata and catalog pricing were still readable through the CLI's default consumer. The project does not need Cloud Billing API enabled merely to retain its current linked billing. Budget configuration/read access remains unverified; no alert or quota was changed.

Some initial Firebase reads returned `SERVICE_DISABLED` for the Cloud SDK OAuth consumer, rather than the Talk project. Repeating product reads with `x-goog-user-project: talk-fc3dc` confirmed the real Firebase settings. The reusable `cloud:inspect` script now includes this header for project product APIs, while leaving billing metadata unscoped. It returns only fixed status/boolean summaries and sanitized reason enums, never provider messages, tokens or fictional codes.

## Estimated deployment cost

This is the proposed small **Mumbai, single-zone pilot** in [APPROVAL.md](APPROVAL.md), not a deployed service or invoice. Assumes 730 hours/month, 10 GiB SSD, Cloud Run minimum zero instances, very light traffic and no HA. Shared-core SQL has no Cloud SQL SLA; it is not a production capacity guarantee.

| Item | Estimate before taxes/eligible credits |
| --- | --- |
| PostgreSQL `db-f1-micro` machine | **₹1.209458249/hour**, approximately **₹882.90/month** |
| 10 GiB Mumbai SSD | Approximately **₹195.82/month** |
| Database baseline | Approximately **₹1,078.72/month**, rounded to **₹1,100/month** |
| Backups | Approximately **₹9.21 per actually stored GiB-month** |
| Cloud Run | Usage-based; light testing may fit unused billing-account allowances; no minimum-instance idle charge with minimum zero |
| Hosting, builds, images, secret access and networking | Additional usage charges above applicable allowances |
| One India authentication SMS | Published **US$0.07/message** before the published first-ten-per-day allowance; actual local currency, usage and billing rules apply |

The machine figure is an **exact returned official INR catalog rate**, effective **2026-10-15 07:00 UTC**, regular PostgreSQL Zonal Micro Mumbai SKU `68AA-006F-9952`. The regional official table lists US$0.0126/hour. The returned catalog conversion factor was 95.98874999870618 INR/USD. SSD and backup INR amounts are **estimates** using that factor with verified Mumbai rates US$0.204/GiB-month and US$0.096/actually stored GiB-month; their exact INR SKUs were not retrieved in the bounded catalog inspection. Rates and actual calendar hours can change.

At the proposed 20 GiB disk-growth cap, machine plus disk baseline is approximately **₹1,275/month** before backup/traffic/taxes/credits. New PostgreSQL PITR logs in Cloud Storage have no additional per-instance charge under the current documented policy; actual backup and disk usage still matter. Do not count every retained backup as the full provisioned disk automatically.

Cloud Run Mumbai request-based rates currently list US$0.000024/vCPU-second, US$0.0000025/GiB-second and US$0.40/million requests, before billing-account-wide allowances. The six proposed active secret versions may fit the shared allowance if other account usage has not consumed it. Extra retained versions can cost money.

The existing frontend build is approximately **501 MB**, including a **415 MB video**. One hundred complete downloads of that video transfer roughly **41.55 GB**, before caching/range-request effects. Hosting transfer can dominate a small authentication pilot's usage; no assets were changed.

**₹1,100 is a database baseline, not a total monthly spending cap.** Credits apply only according to eligibility/expiry. A budget alert does not stop spending. The displayed quota is not a free SMS allowance or delivery guarantee.

Sources: [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Catalog currency semantics](https://docs.cloud.google.com/billing/docs/reference/rest/v1/services.skus/list), [PITR storage](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/restore), [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firebase pricing](https://firebase.google.com/pricing), [SMS pricing](https://cloud.google.com/identity-platform/pricing), [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing), [trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features).

## Before an approval request

1. Review this estimate and the resource proposal in [APPROVAL.md](APPROVAL.md). Approval is needed for the five deployment API enablements, Cloud SQL/database roles, service accounts/IAM, six secret uploads, image build/upload, migration and Cloud Run deployment. Importing local account data needs its own explicit approval.
2. Verify the existing Google OAuth Web Client permits **`https://talk-fc3dc.web.app`** as an Authorized JavaScript origin; keep localhost entries. The exact live client origins were not exposed through these supported reads. The existing popup callback requires no new redirect URI.
3. Backend health, migrations/grants, real proxy boundaries, secure-cookie/session persistence and hosted email/Google/fictional-phone flows must pass before Firebase Hosting publication. All four cloud release-readiness flags remain false.
4. Before requesting **exactly one** real SMS, privately compare the intended personal number against Firebase's fictional list, confirm the current Firebase product SMS cap and billing eligibility, and obtain separate send approval. Never print a personal number, code or token. No automatic resend.

Only the reusable read-only inspection helper and its regression tests were adjusted in this pass. Its four tests passed. Full authentication/production/browser/build checks from the preceding preparation pass are recorded in [APPROVAL.md](APPROVAL.md); they were not represented as real delivery or cloud deployment tests.
