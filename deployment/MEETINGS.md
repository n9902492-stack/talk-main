# Talk meetings: Phases 1–3

Talk reuses the existing `/device-test` pre-join screen and `/meeting` route. Camera preview, device selection, audio meter, speaker sound, five-second microphone recording, display-name input and existing styling remain in place. Join Session now obtains authorized LiveKit access and opens `/meeting?live=1&room=talk-workshop`. The existing sample recording, agenda, whiteboard and transcript preview remain available through the original `/meeting` links; they are not presented as live meeting participants.

## Test locally now

The Windows local server has no cloud cost and binds only to this computer. Its random credentials are stored in ignored `data/livekit-local.json` and `data/livekit-local.yaml`. Do not commit or publish those files.

From the repository root:

```powershell
npm ci
# Only needed once: downloads the official Windows amd64 binary, verifies SHA-256.
npm run meeting:setup
npm run meeting:server
npm run dev
```

If Vite is already running, restart it after the first `meeting:server` run so the backend loads the local credentials. The helper leaves the local LiveKit server running; repeated calls reuse it. Its private log and PID file are under `data/`. To stop it, use Task Manager to stop only the `livekit-server.exe` process belonging to this project, or verify the executable path against `artifacts/qa/livekit/livekit-server.exe` before stopping the PID in `data/livekit-local.pid`.

1. Open **http://localhost:3001/sign-in** and sign in using an existing verified Talk account. Finish Google confirmation when applicable.
2. Open **http://localhost:3001/device-test?room=talk-workshop**. Enter a name and choose your devices and enabled/disabled states. Run the existing device tests as desired.
3. Click **Join session**. For the uncreated default room, choose **Create meeting as host**. This explicitly assigns ownership to your Talk account. The dashboard's existing **Start a session** action creates a fresh owned meeting and opens the same pre-join screen.
4. Use a separate browser or private browser profile on this computer, sign in to Talk, open the same pre-join URL and join. Use headphones to avoid microphone feedback. Some physical webcams cannot be opened by two browsers at once; the second participant can join camera-off, or use a second webcam.
5. Check video/audio in both directions, mute/unmute, camera off/on and Leave Meeting. Leaving stops owned media tracks and returns to the existing pre-join screen.

Use **different verified Talk accounts** to test host versus participant behavior. Ownership, admission, roles and restrictions apply to the account across its browser connections. The second account waits for the host to admit it in Participants. A second browser signed in as the creator is another host connection, not an independent participant role.

`localhost` is local to each computer. This loopback-only setup does not serve another phone/computer. Testing across devices/networks requires an approved HTTPS Talk origin and a reachable WSS LiveKit server with the appropriate WebRTC/TURN configuration. No such infrastructure is provisioned by these changes. See [LiveKit's local server documentation](https://docs.livekit.io/transport/self-hosting/local/) and [production deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/).

## Access and configuration

Meetings now have durable creator ownership. The legacy `talk-workshop` entry requires explicit creation before its first live join. New meetings have generated IDs and independent, non-recycled LiveKit room names. Host approval is on by default. Only verified, confirmed Talk accounts can request access; guests are not enabled. Unknown IDs are rejected. The browser cannot authorize a room, role, identity or publishing permission by supplying metadata or extra fields. See [PHASE3_MEETINGS.md](PHASE3_MEETINGS.md) for the full policy and moderation tests.

The backend module `backend/src/meetings.mjs` owns room configuration and token signing. The endpoints live inside the existing auth app so the existing cookie scope, Hosting cookie envelope, database context, origin validation and CSRF protections apply:

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/auth/meetings/talk-workshop` | Checks the Talk session and room access; returns readiness, trusted title and session CSRF context |
| POST | `/api/auth/meetings/:id/token` | Validates session, admission, lock/end state, CSRF, name and limits; returns an opaque revocable ticket only after admission |
| POST | `/api/auth/meetings` | Creates a new meeting owned by the authenticated account |
| GET | `/api/auth/meetings/:id/state` | Own admission state; admitted participants get current roles/hands/reactions; only moderators get waiting requests |
| POST | `/api/auth/meetings/:id/actions` | Reauthorizes every moderation action against durable account roles |

LiveKit JWTs stay on the backend. The SDK connects through Talk's signaling gateway using an opaque ticket tied to its account, Talk session, meeting and connection. The database stores only the ticket hash. The gateway checks admission on connection/reconnect, replaces upstream refreshed JWTs with opaque tickets, and rejects unsupported region migrations. Internally generated five-minute JWTs grant only room-restricted media/data, with permitted sources derived from current restrictions; no participant gets LiveKit administration or metadata-update rights. Existing Talk authentication is reused. SQLite migration 004 and PostgreSQL migration 002 add meeting/member/connection/audit tables.

Talk tickets expire with the existing session or after eight hours, whichever comes first. Removing an account, ending a meeting, logging out or expiring the session invalidates its relevant tickets. Reconnects recheck the database. A one-second gateway check closes revoked live signaling; server APIs remove participants/update grants, and a five-second reconciliation pass retries durable state after a media-server outage. A failed media-server operation reports pending enforcement rather than success. Leaving stops local tracks; creator ownership does not transfer automatically.

For an existing production LiveKit service, set these **backend-only** settings through the normal private runtime environment:

```dotenv
LIVEKIT_URL=wss://your-livekit-host.example
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
MEETING_SIGNAL_URL=wss://your-approved-talk-backend.example/api/auth/meeting-signal
```

Use the key/secret belonging to that server; the API secret must have at least 32 characters. Never prefix credentials with `VITE_`. Production requires WSS for both the media server and approved Talk gateway endpoint, and never reads local credentials. Firebase Hosting does not proxy WebSockets: the gateway URL must point directly to an approved WebSocket-capable backend/reverse proxy, while normal authentication APIs retain their existing Hosting routing. Missing configuration disables meetings without disabling sign-in. Apply production migrations and runtime table grants before release. Deployment, resources and cloud settings require separate approval.

## Code and checks

- `frontend/src/pages/DeviceTest.tsx`: existing pre-join controls; only the Join action and conditional error/busy state are connected to meeting access.
- `frontend/src/hooks/useMediaPreview.ts`: existing preview capture plus a track-ownership handoff for joining.
- `frontend/src/lib/meetingSession.ts`: secure API client, short-lived in-memory join handoff and non-secret device preferences.
- `frontend/src/pages/MeetingRoom.tsx`: existing route; loads the live component only for a live join and retains the sample preview otherwise.
- `frontend/src/components/LiveMeeting.tsx`: LiveKit room lifecycle, real participant tracks, autoplay recovery, reconnection, controls and cleanup.
- `frontend/src/components/MeetingCanvas.tsx`: responsive grid, focused speaker/pinned views, presentation stage and independent remote audio attachments.
- `frontend/src/components/MeetingPanels.tsx`: participants, chat, information and device settings; mobile dialogs and keyboard focus.
- `frontend/src/hooks/useMeetingChat.ts`, `frontend/src/lib/meetingExperience.ts`: LiveKit data messages, validation, ordering, limits and layout/host helpers.
- `backend/src/meetings.mjs`, `backend/src/auth.mjs`: backend configuration, account/room authorization and restricted token issuance.
- `backend/src/meeting-management.mjs`, `backend/src/meeting-gateway.mjs`: durable account roles/admission/actions and revocable signaling access.
- `frontend/src/hooks/useMeetingManagement.ts`, `frontend/src/components/MeetingModeration.tsx`: trusted state, real LiveKit refresh notifications and existing-panel moderation controls.

```powershell
npm run test:meetings
npm run test:meetings:ui
npm run build
# Requires the real local server above; never uses a fake LiveKit SDK.
npm run test:meetings:browser
npm run test:meetings:experience
npm run test:meetings:moderation
npm run test:auth
npm run lint
```

The backend tests verify real JWT signatures/grants, session and room authorization, CSRF/origin validation, expiry policy and rate limits. The browser test launches two separate Chrome processes against the real local LiveKit server. It uses generated camera video and WAV microphone input, checks received RTP/decoded frames and a non-silent received audio signal in both directions, exercises device handoff and pre-join tests, and checks control propagation and cleanup. Account verification is an isolated fixture with real Talk session cookies and an in-memory database. It does not send an email/SMS, sign into a real Google account or exercise physical camera/microphone hardware.

Browser evidence and screenshots are stored in ignored `artifacts/qa/`; `live-meeting-test-results.json` distinguishes real transport from fixture media and account verification. Real personal-device testing must be reported separately.

## Phase 2 behavior and manual checks

The pre-join screen and media-test hook are unchanged in Phase 2. In a live meeting, use the fixed Talk toolbar for microphone, camera, screen sharing, participants, chat, information, settings and leaving. Grid columns adapt to the canvas and participant count. Focus speaker follows the latest active speaker, retaining that focus during silence. Pinning is local to your view. Screen shares take the main stage automatically; an explicit participant pin can override this, with a Show presentation action to return. If several people present, select the desired presentation above the stage.

Phase 3 replaces the former visual host label with persisted creator ownership. Host/co-host badges come from authenticated backend state. The creator alone changes roles, lock/approval settings or ends the meeting. Co-hosts can admit/deny waiting participants, manage ordinary members' publishing rights, request mute, remove members and lower raised hands. Neither role can remotely activate another person's microphone/camera. Permissions are not inherited by being first to join or last to remain.

Chat is **session-only**: up to 500 messages in each viewer's memory, cleared when leaving/reloading the page. There is no database history, replay for late joiners or offline-delivery guarantee. Reliable LiveKit data packets carry text to actual connected participants. Causal sequence numbers and identity/message-ID tie-breaks order arrivals; duplicate retries are ignored. Reconnecting preserves the draft and current in-memory history; failed sends offer Send again. A successful send means handed to the transport, not a receipt/read acknowledgment from every participant.

Messages are limited to 2,000 characters and 12KB per packet. Both the sender UI and each receiving client limit a peer to 20 messages per 10 seconds. Payloads cannot specify a sender identity/name; those come from LiveKit. The UI renders plain React text, strips unsafe control/directional characters and never interprets message HTML. Client receive limits protect the interface, not a server-enforced anti-abuse service: a modified client can still transmit data under its room-scoped grant. No commands controlling remote media are accepted.

Settings reuse LiveKit's active-device switching. Changes preserve muted/camera-off state and save per-tab preferences. The speaker selector is enabled only where `setSinkId` is supported; other browsers use system output. Disconnected tracks are turned off and the user is asked to choose another device. Camera/microphone permission errors and autoplay blocks are recoverable without leaving. Screen/window/tab choices and whether shared audio is available depend on the browser and operating system; cancelling the native picker leaves the call intact. The browser's Stop sharing action is handled through LiveKit's track-ended lifecycle.

To check manually with two signed-in browsers:

1. Join through the existing pre-join URL above; verify your chosen devices and on/off states.
2. Check the grid, Focus speaker, Pin, participant names/status/count and the host label.
3. Share a harmless tab/window; the other browser should show the presentation and presenter name. Stop with the Talk button and with the browser control on a second share.
4. Send chat in both directions, close one chat panel and confirm its unread badge; reopen to read it. A late joiner should not receive old chat.
5. Open Settings and switch devices while enabled and while muted/off. Check sound output if your browser supports selecting it.
6. Disconnect/reconnect the network briefly, then confirm media and new chat resume. Leaving stops camera, microphone and presentation tracks.
7. Check desktop, tablet and a narrow mobile viewport. On mobile, side panels become dialogs; Escape closes a panel and returns keyboard focus to its toolbar button.

`test:meetings:experience` uses a real local SFU, native browser tab capture of a dedicated colored test page, and actual data-channel transport. It creates additional real connections to exercise four- and nine-participant grids. The moderation suite additionally exercises backend-enforced host controls and revoked-ticket replay. Camera/microphone hardware and account-provider verification are fixtures. Tests never capture a personal desktop, send email/SMS, deploy or provision paid services. Ignored Phase 1–3 JSON results/screenshots under `artifacts/qa` record the latest outcomes. Recording, transcripts, AI summaries, translation, scheduling and webinars remain outside this phase.
