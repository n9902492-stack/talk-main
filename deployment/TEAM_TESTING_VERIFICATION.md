# Team deployment preparation: verification record

19 October 2026. No deployment, service enablement, cloud resource creation, secret upload, SMTP delivery or SMS request was performed.

| Check | Result and boundary |
| --- | --- |
| Authentication and meeting backend regression | 84 passed, zero failed. One real-PostgreSQL case skipped in this direct invocation and exercised separately below. Isolated provider/mail fixtures; not real Google/SMS/email delivery. |
| Actual local PostgreSQL 16 | 17 passed, zero failed/skipped. Existing migrations, encrypted Hosting sessions, verification limits/concurrency, identity isolation, restart persistence, account import behavior and recording metadata/retention. Recording media and speech are fixtures in this group. Disposable Docker database stopped afterward; no Cloud SQL instance created. |
| Deployment/inventory security regressions | 14 passed. Catalog build upload coverage, backend-only/pinned LiveKit secrets, fail-closed URLs, small-team resource caps, fixed GET-only cloud inventory, redaction, pagination and disabled/denied/missing distinctions. |
| Existing Hosting production SDK/config regressions | Eight passed in the configuration audit, including Firebase production test-mode guards. SDK fixtures; no SMS. |
| TypeScript lint | Passed. |
| Frontend production build | Passed. No React/CSS/theme/authentication redesign. |
| Frontend Hosting preparation check | Passed; private markers excluded from browser build. |
| Private backend authentication configuration | Passed local validation only; no database connection or email delivery. Production LiveKit URLs and credentials are still absent. |
| Full Hosting release gate | Intentionally NOT READY: four cloud cookie/database/proxy/auth checks are still unverified. No readiness flags changed to true. |
| Five-browser, two-room regression | **Passed, exit 0.** Actual local SFU rooms held 3 + 2 people concurrently. All five received decoded video, inbound audio packets and positive audio energy. Waiting privacy/admission, cross-room authorization/host/lock denial, isolated real chat, native screen-share fixture pixels, signaling reconnection and ending A while B continues passed. No Rejoin recovery was needed. See `artifacts/qa/two-room-meeting-results.json`. |
| Existing local frontend | HTTP 200 at `http://localhost:3001`. This is not remotely reachable hosting. |

Read-only Google/Firebase checks confirmed an active project, billing enabled, Phone Auth enabled, India allowed, Hosting domain authorized and a provisioned reCAPTCHA key. Hosting has one existing site with no releases; its public root returns 404. Cloud Run, SQL, Artifact Registry, Cloud Build, Secret Manager and Compute APIs are disabled. Resource existence behind disabled APIs remains unverified. The inventory did not access secret payloads, provider account records or promotional-credit balances.

The passing browser test uses five separate Chromium processes, real Talk backend sessions with an isolated Google verifier, generated tones and 640x360/up-to-10fps cameras. It joins with media off, verifies admission and 3+2 connections, then enables each user's microphone/camera through existing controls. This is actual WebRTC transport with synthetic sources, not a locally simulated connection. It does not verify concurrent camera-enabled pre-join startup: earlier attempts timed out on this laptop's pre-join capture readiness and admitted connections. The cause was not established as an application defect versus local fixture/browser contention. Test-only Local Network Access permission and lower capture costs do not bypass production permissions. No production React, media-control or pre-join behavior was changed.

Not yet verified: real Cloud SQL/IAM/secret access, deployed LiveKit Cloud or VM, public WSS/TURN/ICE behavior, hosted cookie/proxy boundaries, actual Google OAuth HTTPS origins, hosted provider flows, physical phones/laptops on separate networks, 60-minute Cloud Run reconnection, actual five-person two-room remote audio/video, or cloud recording/transcription throughput. Follow [TEAM_REMOTE_TEST.md](TEAM_REMOTE_TEST.md) only after the separate approvals and staging steps in [TEAM_TESTING.md](TEAM_TESTING.md).
