# Talk: five-person, two-room deployment proposal

Prepared 19 October 2026. **No resources created, APIs enabled, deployment, email or SMS sent.** This proposal supersedes the older SMS-only resource/cost proposal for this team test. It preserves Talk's frontend, authentication and LiveKit architecture. Recording/transcription are included as a separate estimate; including an estimate does not authorize activation.

## Scope and live inspection

Five authenticated users, simultaneously split between two independent rooms (3 + 2), for **two hours per day, 30 days/month**. The website remains reachable outside meeting hours. Cloud Run may cold-start; this is a single-zone pilot without an availability SLA or HA failover.

Read-only checks on 19 October confirmed:

- Project active; linked billing enabled.
- Firebase Phone Authentication enabled; India allowed; `talk-fc3dc.web.app` authorized; reCAPTCHA site key available. This does not prove a browser challenge or SMS delivery.
- `https://talk-fc3dc.web.app` returns HTTP 404: Talk is not live there.
- Cloud Run, Cloud SQL and Artifact Registry APIs return `SERVICE_DISABLED`. Their resources remain **unverified**, not certified absent. Review and reuse any suitable resources after approved API enablement, before creating duplicates.
- The enabled-services inventory also confirms Cloud Build, Secret Manager and Compute are disabled. Firebase Hosting has one existing site and no releases. These reads did not enable anything or fetch secret payloads.
- Production backend preparation contains existing SMTP settings, a cookie key and proposed database credentials. No deployed LiveKit URL/key/secret or direct signaling URL is configured. Local meetings use the ignored local SFU configuration.
- Promotional-credit balance and expiry cannot be verified through these checks. The previously owner-reported INR 28,797 is not a newly verified balance.

Safe repeat commands: `npm run cloud:inspect`, `npm run hosting:inspect`, `npm run team:inspect`. These issue fixed metadata GETs, redact provider payloads and do not access Secret Manager secret versions. A disabled API or denied permission is not permission to enable it automatically.

## Minimum recommended infrastructure

| Resource | Configuration and reason |
| --- | --- |
| Existing Firebase Hosting site | `talk-fc3dc`, managed HTTPS; publish only `frontend/dist`. Ordinary `/api` HTTP requests rewrite to Cloud Run. |
| One Cloud Run service | `talk-auth`, `asia-south1`, 1 vCPU / 1 GiB, min 0, max 1, concurrency 20, 3,600-second requests; same Node auth, moderation and signaling gateway. Five meeting sockets fit one instance; no separate service per room. |
| One Cloud SQL PostgreSQL instance | PostgreSQL 16, Enterprise `db-f1-micro`, single zone Mumbai, 10 GiB SSD with growth capped at 20 GiB; backups, 7-day PITR, deletion protection. Shared-core has no Cloud SQL SLA. Monitor before considering a larger tier. |
| Database and roles | Existing schema/migrations, database `talk_auth`, restricted runtime role and separate migration owner. Five connections maximum per app pool. No production SQLite. |
| One Artifact Registry repository | Regional Docker repository `talk`; retain current and previous reviewed image. Local Docker build/upload is possible; Cloud Build is optional and incurs build/storage charges if chosen. |
| Secret Manager | Eight pinned secret versions: runtime/migration DB passwords, cookie key, SMTP user/password/from, LiveKit API key/secret. Runtime accesses seven; migrator only its DB password. Existing private files are never uploaded as frontend assets. |
| Two service accounts and one migration job | Restricted runtime and migrator identities; Cloud SQL Client plus per-secret access. Job runs explicitly, no retries, no permanent worker. Reuse approved suitable identities where possible. |
| LiveKit media service | Recommended: one LiveKit Cloud **Ship** project; both rooms use it. Alternative: one self-hosted GCP Linux VM described below. No media is relayed through the auth backend. |

No load balancer, Kubernetes, NAT gateway, separate TURN subscription, Firestore, or recording bucket is required for the meeting-only option. The APIs needed for the chosen plan are dependencies, not five separately provisioned application servers. Cloud Build and Compute API/resources are optional according to the chosen build/media option.

### HTTPS, WebSockets and room isolation

Firebase Hosting stays the HTTP API origin so the existing encrypted `__session` cookie remains Secure, HttpOnly, SameSite=Lax, host-only, scoped to `/api/auth`. Keep CSRF and Origin checks. Confirm actual proxy hops before changing the trusted-proxy allowlist; never trust arbitrary forwarding headers.

Set backend-only `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `MEETING_SIGNAL_URL`. The latter must be **`wss://ACTUAL-CLOUD-RUN-HOST/api/auth/meeting-signal`**, using the URL returned after approved backend creation. Do not send signaling through the Hosting rewrite: Hosting has a 60-second request limit. Cloud Run supports WebSockets but forces reconnection at at most 60 minutes; verify a two-hour call across that boundary. One active socket keeps the instance active/billed; five sockets on one instance are not five instances. Keep HTTP/2 end-to-end disabled.

The browser receives an opaque revocable Talk ticket, never a LiveKit API secret or raw SFU JWT. The direct cross-origin WebSocket validates its Origin and persisted ticket/session/admission; it does not depend on sharing Hosting cookies with `run.app`. Backend-only LiveKit JWTs authorize exactly one immutable randomly generated room. Owners/co-hosts, admission, locks, blocked accounts and publishing restrictions remain database-enforced. Never accept arbitrary room names from a browser as authorization.

The gateway rejects provider `roomMoved` packets intentionally: they move a participant into another **logical meeting**, which requires Talk authorization. This is not a regional migration. The gateway hostname prevents LiveKit's browser-side Cloud-region optimization; actual Cloud handshake/reconnection/TURN remains a release test, not a claimed result of local tests. Keep this security boundary rather than bypassing the gateway to make a demo connect.

**Before the first hosted meeting connection**, apply the reviewed filter in `meeting-signal-log-exclusion.json` to request-log storage sinks. Cloud Run request URLs can contain opaque `access_token` tickets. Exclude these credential-bearing request entries from `_Default` and any applicable custom/export sinks; inspect other tracing/error middleware too. Keep sanitized application health/error metrics and database moderation audit events. Do not copy full request URLs, cookies, tokens, numbers, codes or passwords into diagnostics. This local JSON does not create a logging rule.

### WebRTC connectivity

LiveKit Cloud manages public WSS, ICE and TURN/TLS fallbacks; allow its documented endpoints in corporate networks. UDP is preferred; test a restrictive/relay-only network too. Localhost or a private LAN SFU URL cannot work for the team. HTTPS is required for camera/microphone permissions. Browser/device support may limit mobile screen sharing and speaker selection; desktop screen-share functionality does not imply that every mobile browser can originate a share.

Self-host alternative: one public Linux SFU VM, fixed public IP, owned domain + DNS, valid TLS, embedded TURN and reverse proxy (Redis can share this pilot VM if needed). Start a **provisional** `e2-medium` (2 shared vCPU / 4 GiB, approximately one sustained core); benchmark five video users before accepting it. A dedicated `e2-standard-2` (2 vCPU / 8 GiB) provides more headroom. Neither is a provider-guaranteed capacity figure. No need for two servers for two rooms. Expose only documented public ports: HTTPS/TURN TLS 443, ICE TCP 7881, TURN UDP 3478 and ICE UDP 50000-60000. With separate TLS/443 endpoints, configure the provider-supported hostname/IP arrangement; don't bind two unrelated listeners to the same socket. Keep SFU HTTP/API port 7880 private behind TLS. Do not try to run the UDP SFU on Cloud Run. One VM is not HA.

## Monthly cost estimate

All amounts are **before taxes**, at published on-demand USD rates, with **INR 100/USD used only as a conservative planning conversion**, not a live exchange rate or INR billing quote. Calendar hours use 730. Real invoices depend on regional currency SKUs, credits, bitrate, screen sharing, downloads and other billing-account usage.

### Meeting-only option

| Item | USD/month | INR planning amount |
| --- | ---: | ---: |
| Mumbai SQL micro, 730 x $0.0126 | 9.20 | 920 |
| 10 GiB SQL SSD, $0.204/GiB-month | 2.04 | 204 |
| SQL backup example, 10 actually stored GiB x $0.096 | 0.96 | 96 |
| Cloud Run, 60 active hours, 1 CPU / 1 GiB | 5.72 gross; about 0.86 if otherwise unused free allowances apply | 572 gross / about 86 after available allowances |
| Hosting/images/secrets/build/log/network allowance | Variable; reserve 3-8 initially | 300-800 |
| LiveKit Ship | 50 base | 5,000 |

**Recommended planning budget: approximately INR 6,500-8,500/month for meetings only**, allowing some overhead above the baseline. This is not a spending cap. A warm minimum-one Cloud Run instance with the proposed 1 GiB costs about $17.78/month gross at this usage, instead of $5.72; minimum zero remains reachable every day with cold starts. The database and paid LiveKit plan continue costing money when nobody is meeting.

LiveKit Build ($0) includes **5,000 participant-minutes and 50 GB downstream per month**, with 100 concurrent connections; these are hard quotas, not unlimited daily video. Your 5 x 120 x 30 = **18,000 participant-minutes** exceed Build. Ship includes 150,000 minutes and 250 GB downstream; additional usage is $0.0005/minute and $0.12/GB. At two hours/day, the 3+2 split creates eight remote-camera deliveries. At 0.5/1/1.5 Mbps per camera, estimate roughly 101/201/302 GiB downstream before audio/screen sharing/overhead; the higher example adds approximately $6.20 to Ship. Measure actual usage; a five-person team can still transfer substantial video.

Self-host comparison, before the same INR 1,300-2,000-ish Talk backend/overhead. The initial rows use default Premium internet transfer:

| SFU option | Always-on compute | Other estimated monthly costs | Total SFU example |
| --- | ---: | --- | ---: |
| `e2-medium` Mumbai | $29.38 | IPv4 $3.65, disk approximately $1-2, network approximately $24.14 at 201 GiB x $0.12 | About $59 / INR 5,900 |
| `e2-standard-2` Mumbai | $58.75 | Same disk/IP/network assumptions | About $88 / INR 8,800 |
| LiveKit Cloud Ship | $50 plan | Transport overage when allowances are exceeded | About INR 5,000-6,000 at the example bitrates |

With Premium networking, self-hosting is approximately **INR 7,200-10,800/month including Talk**, at the 1 Mbps assumption, before a domain, tax, higher traffic and maintenance.

**Cheaper Standard Network Tier alternative:** Mumbai regional VM IPv4 supports Standard, whose first 200 GiB/month can be free when the shared billing-account allowance is unused; the next Mumbai tier is $0.11/GiB. Budget conservatively as one account-wide allowance across regions, rather than multiplying it per VM. The example 216 GB decimal is 201.17 GiB, approximately $0.13 egress. This brings the same SFU estimate to **INR 3,412 shared CPU or INR 6,349 standard CPU**, and **approximately INR 4,700-5,400 or INR 7,650-8,350 including Talk** before tax/domain/audio/screen-sharing/overhead. A practical rounded Standard-tier budget is INR 5,000-9,000/month depending on CPU and traffic. If the allowance is consumed elsewhere or bandwidth increases, charges increase.

Standard direct-VM UDP/TCP is architecturally compatible with LiveKit, but it routes through regional peering and ISP transit rather than Premium's global backbone. Validate jitter/loss and mobile TURN before choosing it for daily calls. A tier change requires a different public IP and corresponding DNS/announced-IP review; do not flip it during calls. Standard's allowance does not discount Cloud Run Premium or GCS downloads automatically. A VM's transfer charge does not disappear because LiveKit is open source. Shared-core capacity is provisional, no dedicated free Mumbai VM allowance applies, and the attached IPv4/disk continue to cost money according to their lifecycle. This is the lower cash-cost option to consider when using eligible GCP credits; Cloud remains simpler to operate.

### Optional recording and transcription estimate

Two rooms recorded two hours/day produce **120 room-hours = 7,200 recording minutes/month**. Talk currently uses its own consented Chromium/FFmpeg subscriber recorder and local Whisper, not LiveKit Egress. Preserve that implementation; do not enable Egress or a paid speech API implicitly.

- The two recorder subscribers add 7,200 ordinary LiveKit participant-minutes, giving approximately 25,200 total. At 1 Mbps per camera, combined participant/recorder downloads are about 327 GiB before other traffic, approximately **$59.23 / INR 5,923** total Ship transport rather than $50.
- Capture workers need CPU outside ordinary HTTP requests, an approved orchestration/lifecycle plan and durable jobs. Do not enable the existing capture/transcription worker inside the scale-to-zero/request-throttled auth service. Two provisional `e2-standard-2` capture workers for 60 hours each cost about **$9.66 / INR 966 compute** only if actually stopped outside capture. Always-on costs about **$117.51 / INR 11,751 compute**. This is a sizing estimate, not a two-worker cloud benchmark or an implemented scheduler; add disks, IPs/network if used.
- A private Mumbai Standard GCS bucket with uniform access, public-access prevention, lifecycle retention and authorized playback is required if approved. At 1-3 Mbps composite video, 30-day steady retention is about 50-151 GiB, **$1.01-3.02 / INR 101-302 storage**. Reading all recordings once to India adds approximately **$6-18 / INR 600-1,800**. Audio-only at 128 kbps is about 6.44 GiB, roughly INR 13 storage and INR 77 per full read. Operations and backend-proxied playback can add charges; do not double-count or assume free downloads.
- Current 512 MiB per-segment storage and two-hour duration limits still apply. At 2 Mbps, 512 MiB is roughly 36 minutes before container/audio overhead; long video needs explicit stop/start segments or a reviewed limit change. Pause is not fabricated.
- **Whisper transcription has no per-minute provider fee but is not free compute.** The measured Hindi medium-model run took approximately 34x speech duration on the local two-thread CPU. At that speed, 120 hours of Hindi needs about 4,080 worker-hours, exceeding one month's 730 hours. The current serial transcription lease also prevents solving this merely by adding identical workers. A cloud benchmark and reviewed throughput design are required before quoting or approving the existing local transcription workload. Do not describe it as deployment-ready at this volume.
- Optional future alternative, **not currently integrated/approved**: Google Speech-to-Text V2 standard batch $0.016/minute gives **$115.20 / INR 11,520**, or supported low-urgency dynamic batch $0.003/minute gives **$21.60 / INR 2,160**, for 7,200 mixed mono minutes. Model/region English/Hindi compatibility, channel billing, privacy and asynchronous integration require review. Separate individual tracks increase billed minutes. No paid API has been activated.
- Managed LiveKit composite Egress is another architecture change, not the existing recorder price. At 7,200 minutes and Ship's 600 included transcode minutes, it adds about **$132 video or $33 audio-only**, before transport/storage/STT.

There is consequently **no honest fixed total for recording plus the current Whisper workload yet**. An illustrative approved scheduled-capture + compatible dynamic-batch-STT redesign would start around INR 10,000-15,000/month including meetings and one complete playback, before scheduling/extra storage/transfer/taxes; it is not the configuration being proposed for immediate meeting deployment. Standard STT and always-on workers can raise it materially. Approve recording infrastructure only after separate sizing and throughput validation.

### Credits, free tiers and limits

Eligible Google Cloud-owned Cloud Run, Cloud SQL, Compute, storage, build, networking and Secret Manager usage can consume valid promotional credits according to the account terms and expiry; verify the account's credit eligibility before relying on it. Firebase Hosting usage above its allowances is separately metered on the linked account. **LiveKit Cloud, a purchased domain, third-party services and applicable taxes are not paid by Google Cloud credits.** Trial credits do not make resources permanently free or prevent bills after expiry. No new SMS is part of this test; Phone Auth usage has its own pricing and approval.

Cloud Run free allocations are shared across the billing account. Cloud SQL micro has no perpetual free tier. Hosting includes 10 GB storage and 360 MB/day transfer; excess is $0.026/GB storage and $0.15/GB transfer. Secret Manager includes six active versions and 10,000 accesses/month; this proposal has eight versions, so at least two are outside that version allowance ($0.06/version-month), assuming the allowance is otherwise unused. Artifact Registry includes 0.5 GiB then roughly $0.10/GiB-month. These allowances are not unlimited free infrastructure. The existing frontend includes a large approximately 415 MB reference video; repeated landing-page downloads can exceed the small Hosting transfer allowance even with five people. No assets/design were changed. Restrict retained releases/images and measure actual transfers; do not remove assets without reviewing their use.

Proposed Google billing budget: INR 3,000/month for the Cloud media option's GCP portion, alerts at 50/80/100% plus forecast notification; separately track the $50+ LiveKit invoice/usage. For self-hosted Standard networking, propose INR 7,000 shared-CPU or INR 10,000 standard-CPU project alerts instead; Premium/higher traffic requires a larger reviewed budget. Recording requires its own larger reviewed budget. Ordinary alerts do not stop spending. Where available, a Cloud Run service-specific spend cap can pause new usage, but has latency and does not cap SQL/VM/storage or external LiveKit charges. Enforce max app instances 1, pool 5, disk-growth cap 20 GiB, bounded logs/images, regional resources and monthly LiveKit usage alerts. Resource caps are not a universal financial hard cap.

## Deployment sequence — only after separate approval

1. Choose Cloud Ship versus self-host and confirm the pre-tax monthly budget, credit expiry and whether recording stays off for the first remote-device test. Review live reuse candidates again after permission/API access; do not create duplicates.
2. Approve required API enablement, exact resources, IAM, log exclusions and secret uploads. No broad Owner role for runtime; no service-account JSON in frontend. For Cloud, create/use a reviewed LiveKit project and save credentials privately; for self-host, additionally approve VM/IP/domain/firewall/DNS/TLS work.
3. Provision the reviewed database with backup/PITR/deletion protection; create separate migrator/runtime roles. Apply existing migrations and grants once. **Do not import local users or account data without explicit data-import approval.** Fresh test accounts can use existing auth flows.
4. Build/review the existing backend image, including required shared catalogs, and upload immutable image digest. Create the migration job, execute approved schema migration, then deploy backend. Add the actual direct WSS URL and approved SFU WSS URL; pin secret versions. No replacement auth/meeting architecture.
5. Before real sockets, configure and verify log exclusions without printing credential-bearing URLs. Verify `/healthz`, database restart persistence, Origin/CSRF rejection, trusted proxy boundaries and secure cookies. Verify genuine SFU signaling, TURN fallback and 60-minute reconnect. Provider secrets remain backend-only.
6. Google Cloud Console: add **`https://talk-fc3dc.web.app`** to the existing Google Web Client's Authorized JavaScript origins; retain localhost. Existing GIS popup/ID-token flow needs **no new redirect URI**. Firebase authorized domain is already confirmed; production phone test flag stays false and app verification enabled. The OAuth client origins could not be verified through these supported reads. If the OAuth consent app is restricted/testing, allow all five test accounts appropriately.
7. Approve the staged Hosting publication separately. The current gate deliberately blocks the first full application release until hosted authentication has evidence; a normal preview domain will not work against a backend whose only allowed origin is the production site. Resolve this with an **explicitly reviewed API-only bootstrap release** on the final Hosting origin, containing only a temporary verification page and the existing `/api` rewrite, not the full application. This needs its own approved, narrowly scoped bootstrap config/preflight; it is not prepared or authorized as a bypass in this pass. Then a controlled browser runner can serve the reviewed local `frontend/dist` static assets through request routing at that exact HTTPS origin while forwarding every `/api` request untouched to real Firebase Hosting/Cloud Run. Verify actual cookies, CSRF/proxy boundaries and genuine approved provider flows, without a duplicate backend or relaxed Origin rules. Static assets in this step are local; the API/cookies/production backend are real. Record that distinction and obtain separate real email/SMS delivery approval where required. Only successful hosted evidence may complete the existing readiness flags, after which the normal full Hosting deployment can run its unchanged predeploy gate. Finally repeat smoke checks with real CDN-served assets and all five users. Do not mark unknown checks true, expose fixture verifiers in production, or weaken the gate to make an initial release pass.
8. Execute the manual remote-device checklist in `TEAM_REMOTE_TEST.md`, including calls longer than one hour. Only then mark cross-network team validation complete.

Rollback: retain the previous Hosting release and backend image/revision; restore Hosting release and route Cloud Run traffic back to the reviewed revision. Drain/notify active meetings before rollout; instance limits can temporarily overlap revisions during a deployment. Keep SQL data and cookie keys; no destructive down-migrations or automatic database deletion. Restore from reviewed backup only after explicit approval and a data-loss/restore-point decision. With no prior deployed release, unpublish/disable public invocation after approval rather than inventing a rollback target. LiveKit subscription cancellation/VM shutdown is a separate action; disk/IP/backups may continue charging. Do not delete accounts, recordings or databases as an automatic cleanup step.

## Sources (official, checked 19 October 2026)

- [LiveKit pricing](https://livekit.com/pricing), [quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/), [bandwidth estimation](https://kb.livekit.io/articles/3947254704-understanding-livekit-cloud-pricing), [Cloud firewall](https://docs.livekit.io/deploy/admin/firewall/), [self-hosting](https://docs.livekit.io/transport/self-hosting/vm/).
- [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [Cloud Run pricing](https://cloud.google.com/run/pricing), [Hosting/Run rewrite limits and regions](https://firebase.google.com/docs/hosting/cloud-run).
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Compute regional pricing](https://cloud.google.com/products/compute/pricing/general-purpose), [IP/network pricing](https://cloud.google.com/vpc/network-pricing), [Cloud Storage pricing](https://cloud.google.com/storage/pricing).
- [Standard/Premium Network Tier rates](https://cloud.google.com/network-tiers/pricing), [Network Tier capabilities](https://docs.cloud.google.com/network-tiers/docs/overview).
- [Speech pricing](https://cloud.google.com/speech-to-text/pricing), [Speech model/language support](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp-model), [Firebase pricing](https://firebase.google.com/pricing), [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing).
- [Trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features), [budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets), [service-specific spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps), [Logging exclusions](https://docs.cloud.google.com/logging/docs/routing/overview).
