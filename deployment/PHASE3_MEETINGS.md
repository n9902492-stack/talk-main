# Phase 3: meeting ownership and moderation

The existing pre-join screen and `useMediaPreview` hook are unchanged. The live interface keeps its grid, focus/pin views, media controls, screen sharing, chat, settings, authentication and Talk styling. Management actions extend Participants and More options.

## Local workflow

1. Start the local LiveKit server (`npm run meeting:server`) and Talk (`npm run dev`, port 3001). Restart an existing Vite process after backend changes. Local SQLite migrations apply automatically; no cloud resources are created.
2. Sign in at http://localhost:3001/sign-in. On the dashboard, **Start a session** creates a meeting owned by your authenticated account and opens the existing pre-join screen. Alternatively use http://localhost:3001/device-test?room=talk-workshop and explicitly create the default room after Join session if it has no owner.
3. Join, open Participants and copy the meeting link. Open it in another browser with a **different verified Talk account**. Two browser connections using the creator's account both have the creator's role.
4. The second account sees **Waiting for host to let you in.** Admit, Deny, or Admit All in the host's Participants panel. Waiting users receive no signaling ticket and cannot see/hear the room, receive chat, or fetch its participant/reaction information. Their local pre-join captures are stopped while waiting; selected preferences are reused upon admission.
5. Expand **Manage participant** on an ordinary participant to request mute, restrict/restore publishing, appoint/remove a co-host or remove the account. A mute request asks for consent. Restoring permission never remotely turns devices on. Video restriction also covers screen-share video; audio restriction covers microphone and shared audio.
6. Raise/lower your hand from the toolbar. Participants shows the ordered raised-hand queue; moderators can lower permitted participants' hands. More options contains short-lived emoji reactions, host lock/approval settings and End meeting for everyone.
7. Removed/denied accounts stay blocked. The creator can choose **Authorize again** under Denied or removed accounts, then Admit the pending account. Old revoked tickets stay invalid; the user returns through pre-join for a new authorized connection.
8. Leave Meeting leaves the call without changing ownership or ending it. Only the creator can End for Everyone, with an explicit confirmation. Ended meetings cannot be restarted under the same ID. Use Create another meeting or the dashboard's Start a session for a fresh link.

## Authority and state

| Role | Permissions |
| --- | --- |
| Creator/host | All meeting controls; only role that can appoint/revoke co-hosts, reauthorize blocked accounts, change lock/approval settings, or end for everyone |
| Co-host | Admit/deny/admit-all; remove/restrict/restore/request mute for ordinary members; lower ordinary members' hands |
| Member | Own media, chat, screen share if allowed, own raise/lower hand, reactions and leave |

The creator cannot be removed, demoted or restricted by another account. Co-hosts cannot moderate the creator or another co-host. Creator ownership persists when the host leaves; the first remaining participant does not inherit it. This phase has one fixed co-host permission set rather than a custom permission editor.

The existing authentication database now includes `talk_meetings`, `talk_meeting_members`, `talk_meeting_connections` and `talk_meeting_events`. SQLite migration 004 and PostgreSQL migration 002 preserve existing accounts/sessions. Production migration remains an operator step, and the account-data importer includes meeting data when present (older backups without meeting tables remain supported). No second authentication system is introduced.

Each write checks a verified, confirmed Talk session, exact origin, JSON content type, CSRF, rate limits and current database role. Meeting transactions serialize decisions, including admission/removal/role changes. The client cannot supply its account ID, role, room name or grants. Locks reject new unapproved accounts; already admitted accounts may reconnect, and explicit host admission authorizes waiting accounts even while locked. Turning approval off applies to new requests; existing pending accounts still require a decision.

Important moderation actions are audited with account/target IDs and server timestamps. Raised-hand order uses server timestamps and stable account-ID ties. Reactions use the shared 24-emoji allowlist, expire from visible state after six seconds and are pruned from the database after one minute. Each account can request five reactions per ten seconds, with an additional IP limit. Chat retains its Phase 2 session-only behavior and is not persisted here. See [expanded reactions and avatars](REACTIONS_AVATARS.md).

## Signaling gateway and revocation

Self-hosted LiveKit does not revoke old bearer JWTs on participant removal. Returning ordinary LiveKit JWTs to the browser would therefore leave a replay path. Talk instead returns a random opaque ticket, stores its hash and binds it to the account, Talk session, meeting and connection. The browser SDK still connects to a real LiveKit room, through Talk's WebSocket signaling gateway; media remains WebRTC through the SFU.

The gateway verifies the ticket on each connection/reconnection and privately signs current room/source-restricted LiveKit JWTs. Both binary and JSON refreshed JWT messages are rewritten to the opaque ticket. Unsupported room/region migration messages fail closed rather than exposing their upstream credentials. Browser clients never receive LiveKit administrative grants. Directly replaying a Talk ticket to the SFU fails JWT authentication.

Removal revokes all of the account's tickets in that meeting; end revokes every meeting ticket. Session expiry/logout is checked through the existing session table. Live signaling is rechecked every second; server APIs enforce removal and publishing changes. A five-second reconciliation pass retries desired state following a server outage. API errors explicitly report pending enforcement, and users should not treat an unconfirmed operation as successfully applied. These are bounded asynchronous distributed updates, not instantaneous network-wide revocation.

Management state is fetched from authenticated HTTP APIs with a two-second fallback poll. Real LiveKit server data packets notify clients to refresh immediately after changes. Client-authored data packets never authorize moderation. Polling restores authoritative state across reconnection or a missed notification. Reaction display and waiting notifications can have up to the poll interval of delay.

## Production requirements — preparation only

- Keep private LiveKit credentials on the backend. Set `MEETING_SIGNAL_URL=wss://YOUR-APPROVED-BACKEND-HOST/api/auth/meeting-signal`; the gateway must accept WebSocket upgrades under `/rtc` and `/rtc/v1` beneath that prefix. No query/body/token logging is allowed at the proxy. Use the configured frontend origin as the allowed WebSocket Origin.
- Route the public WSS endpoint directly to a WebSocket-capable Talk backend/reverse proxy; this implementation does not use Hosting HTTP rewrites for signaling. Normal authentication API routing, Google origins and Hosting-compatible cookies remain unchanged. The WSS ticket is validated against the existing backend session even when the gateway has a different hostname.
- Apply PostgreSQL migrations and reapply runtime grants. Persist the database and existing authentication cookie keys. Production fails closed for incomplete LiveKit/gateway configuration while keeping the existing authentication system available.
- Review gateway connection capacity, WebSocket timeouts and platform lifecycle. The Cloud Run review template now uses a 3,600-second timeout; clients must still support reconnects. Local tests do not verify Cloud Run, HTTPS/WSS routing, TURN or another physical network. Region migration through LiveKit Cloud is intentionally unsupported by this gateway version.
- Deploying, provisioning, changing cloud settings or enabling paid services still requires separate approval. No Phase 4 functionality is included.

Official references: [LiveKit participant/server APIs](https://docs.livekit.io/reference/other/roomservice-api/), [self-hosted token revocation limitation](https://docs.livekit.io/transport/self-hosting/), [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [Hosting HTTP rewrites](https://firebase.google.com/docs/hosting/full-config).

## Checks and evidence

```powershell
npm run test:meetings
npm run test:meetings:ui
npm run build
npm run test:meetings:browser
npm run test:meetings:experience
npm run test:meetings:moderation
npm run test:meetings:restricted-share
npm run test:auth
npm run test:auth:google-browser
npm run test:auth:otp-browser
npm run test:auth:phone-browser
npm run lint
```

Backend unit tests use isolated media-service fixtures to test authorization, state transitions and failure paths. Browser suites use the actual local SFU, backend, SQLite, gateway, WebRTC and data channels. Camera/microphone hardware and account-provider verification are fixtures; no SMTP or SMS messages are sent. The moderation test checks actual SFU permissions, participant removal, rejection of removed tickets at the gateway and directly at the SFU, preserved opaque refresh tokens, reconnection, leave/end and responsive controls. The prior suites retain real tab screen capture, bidirectional decoded media and chat checks. Ignored `artifacts/qa/phase-three-meeting-results.json` distinguishes a passing real moderation run from a test that failed partway through. Physical devices, production PostgreSQL and deployed HTTPS infrastructure must be reported separately.
