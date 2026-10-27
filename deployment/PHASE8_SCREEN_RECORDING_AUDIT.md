# Phase 8 screen recording audit — 24 October 2026

## Scope and initial findings (before functionality changes)

Requested saved content: shared screen, meeting audio and participant cameras. Public capture is not authorized. This work uses disposable local identities, synthetic media and a loopback LiveKit server. No existing recordings, accounts, databases, tunnel, SMTP or AI settings are changed.

The existing architecture is a **server-controlled headless Chromium recorder**, subscribing to the existing LiveKit room with a short-lived, room-scoped subscribe-only credential. It is neither a participant's local screen recorder nor LiveKit Egress. No paid egress is required by this implementation. The worker cannot request the server computer's camera, microphone or screen.

`recorder-client.mjs` mixes consented participant audio through Web Audio and composites subscribed camera and screen-share tracks onto a 1280×720 canvas. Shared screens appear first in the grid, alongside cameras. Encoding is WebM VP8/Opus, 15 fps, target 4.5 Mbps video / 128 kbps audio. Quality depends on source resolution, bandwidth and worker capacity. This is a fixed composite, not separate editable participant tracks.

## Feature inventory at audit time

Historical evidence is identified explicitly; fresh verification results are recorded separately below. Historical local tests do not certify public or real-device capture.

| Feature | Classification | Evidence / limitation |
| --- | --- | --- |
| Request/start/stop UI and authoritative state polling | IMPLEMENTED AND VERIFIED | Prior saved-media browser reports; `MeetingRecording.tsx`, `useMeetingRecording.ts` |
| Host/co-host backend authorization and explicit start | IMPLEMENTED AND VERIFIED | Existing recording API tests; opening controls only fetches state |
| Account-participant consent and withdrawal | IMPLEMENTED AND VERIFIED | Backend start/join gates, identity filtering; historical withdrawal/late-join tests |
| Booking-guest recording consent | MISSING | Backend deliberately rejects recording with admitted booking guests; do not bypass this restriction |
| Authorized server recorder and duplicate-worker protection | IMPLEMENTED AND VERIFIED | Worker leases, active-segment index, recorder lifecycle tests |
| Camera video and mixed meeting audio | IMPLEMENTED AND VERIFIED | Prior two-browser real local WebRTC capture, decoded files and browser playback |
| Saved shared screen together with cameras/audio | IMPLEMENTED BUT NOT VERIFIED | Screen-share source is composited in existing client; fresh decoded-media test required |
| Finalization, storage commit and completed metadata | IMPLEMENTED AND VERIFIED | Historical stop/failure/restart tests; completion follows file commit and size verification |
| Private playback, download and HTTP range | IMPLEMENTED AND VERIFIED | Authorized proxy routes; historical playback and export tests |
| Stop on host end, withdrawal, worker loss and limits | IMPLEMENTED AND VERIFIED | Existing lifecycle suites and historical real host-end capture |
| Failed status without disconnecting meeting | IMPLEMENTED AND VERIFIED | Existing failure/recovery tests; failures do not become Ready |
| Local Whisper transcription and language selection | IMPLEMENTED AND VERIFIED | Historical actual English/Hindi model tests; current mock/model-routing regression to be rerun |
| Accurate arbitrary speech / fast long Hindi transcription | PARTIALLY IMPLEMENTED | Accuracy is source-dependent; prior Hindi CPU benchmark was slower than real time |
| Transcript search, seek, regeneration, TXT/PDF | IMPLEMENTED AND VERIFIED | Historical UI/export/revision tests; no speaker diarization |
| Recording retention/deletion | IMPLEMENTED AND VERIFIED | Durable deletion jobs, retention and authorization suites |
| Private GCS storage | IMPLEMENTED BUT NOT VERIFIED | Adapter has mocked tests; no real bucket verification authorized |
| Public five-user recording and external-device capture | BLOCKED BY INFRASTRUCTURE | Isolated adapter supplies `recordings: {configured:false}` and blocks mutation/playback routes; explicit approval and capacity/security preflight required |
| Cloud LiveKit Egress | MISSING | Not used or needed for current local-browser architecture; must not activate silently |

## Lifecycle, persistence and security

States: awaiting consent → starting → recording → stopping → processing → completed (UI Ready), or failed; deleted revokes access. Requesting consent does not start capture. Only the backend can start the worker after checking authority, current admitted participants and consent. Worker subscriptions are restricted to consented identities. Late joining requires consent; withdrawal stops active capture. Meeting termination also finalizes capture. Active-recording uniqueness and worker ownership prevent reconnect from starting another recorder.

The recorder writes an exclusive partial file, flushes MediaRecorder, fsyncs and remuxes with FFmpeg, then commits storage. The backend verifies persisted size before committing completed metadata. Local default storage resolves absolutely to `C:\Users\ss828\Downloads\talk-main\data\recordings`; it is not a static public directory. Tests use their own artifact directories. Production local storage requires an explicit durable volume; the alternative private GCS adapter requires uniform access/public-access prevention. Existing saved media is preserved.

Playback/download and transcript access require an authorized host/co-host and unexpired retained media. Download uses the same authenticated proxy. Retention/deletion revoke access and queue file removal. Capture limits are two concurrent workers, 16 people in video mode, two hours / 512 MiB per segment; host quota is 2 GiB. These are laptop-oriented limits, not a public-load certification.

SQLite migration `007_meeting_recordings.sql` and PostgreSQL migration `005_meeting_recordings.sql` define recordings, consents, events, jobs and transcript segments. `transcript-revisions.mjs` preserves prior transcript content. No migration is proposed for this audit.

## Relevant implementation and documentation

- Frontend: `MeetingRecording.tsx`, `useMeetingRecording.ts`, `MeetingHistory.tsx`, `RecordingsWorkspace.tsx`, recording styles.
- Backend: `meeting-recordings.mjs`, `recording-runtime.mjs`, `recording-recorder.mjs`, `recorder-client.mjs`, `recording-client-bundle.mjs`, `recording-storage.mjs`, `recording-transcriber.mjs`, `recording-exports.mjs`, `transcript-revisions.mjs`, meeting authorization/token integration.
- Runtime: `runtime-auth.mjs`, Docker Chromium/FFmpeg dependencies, production example `RECORDING_PROVIDER=disabled`, public `five-user-test.mjs` hard-disabled runtime.
- Prior reports: `RECORDING_TRANSCRIPTION.md`, `RECORDING_TRANSCRIPTION_VERIFICATION.md`, `RECORDING_SAVE_REPAIR.md`, `RECORDING_AV_SYNC.md`, `RECORDING_QUALITY_ACCURACY.md`.

## Fresh verification

At the initial audit checkpoint these checks were pending, and no recording functionality had been changed.

- Backend/security regression run: **66 passed, 0 failed, 0 skipped**, `artifacts/qa/phase8-screen-recording-regression.tap`. Includes authorization, CSRF/origin, consent/withdrawal, startup/stop deadlines, worker ownership/teardown, failed storage acknowledgments, transcript recovery/retention/revisions, private range playback and public-route restrictions. GCS is mocked; PostgreSQL execution is not part of this fresh run.
- Initial real-media screen recording run: **passed** (`artifacts/qa/recording-screen-share-NhkWqd/results.json`). Two separate Chrome sessions, a fresh SQLite DB and an independently started loopback LiveKit SFU. Native tab sharing captured a changing synthetic presentation, alongside red/green synthetic cameras and distinct 440/660 Hz microphones. Both saved files decoded; the player advanced and sought in Meeting Details. Normal stop saved 557,778 bytes / 14.154 seconds; host-end saved 548,757 bytes / 13.913 seconds. Restart retained the same media key/bytes and playback. Member playback was denied; host download and range reads passed. The playback screenshot was visually inspected.
- Fresh shared-screen capture classification: **IMPLEMENTED AND VERIFIED locally with synthetic media**. This does not certify public recording, five recorded participants, physical devices or long-session throughput.
- Main local storage inspection: default `data/recordings` exists with write access; approximately 189 GB available on the volume at inspection. Actual writes/remux/commit were verified only in new test-owned storage, preserving existing recordings. The local Whisper executable and base/English/Hindi models are present. No download occurred. A real Whisper speech run was not repeated in this screen-capture check; transcription regression providers are fixtures.
- Active public HTTPS `/healthz`: **HTTP 200**, five-account allowlist count 5; recording, transcription, SMTP, OTP, SMS, Gemini and Calendar live operations all **false**. `artifacts/qa/phase8-public-disabled-check.json`. Initial direct loopback probes returned the adapter's expected 403 for missing/mismatched connector request validation; the actual existing HTTPS route was then checked successfully. No tunnel or service was restarted.
- TypeScript: **passed**, `artifacts/qa/phase8-screen-recording-typescript.log`.
- Production frontend build: **passed**, isolated output `artifacts/qa/phase8-screen-build`; existing large-chunk warning remains. `artifacts/qa/phase8-screen-recording-build.log`. Active public frontend assets were not replaced.
- The user reports live audio/video and screen sharing worked. Device/network/participant scope has not been independently recorded for that report; it is not evidence of a public recording pass.

## Small integration change

The existing `video` capture mode already records all three requested sources. Its frontend label is now **Screen, cameras & audio**, with explicit guidance to share a screen in the meeting. The audio-only default, consent, worker and storage implementation remain intact. No backend recording rewrite or public activation was needed.

Files changed for this task only:

1. `frontend/src/components/MeetingRecording.tsx` — mode/status wording and screen-sharing guidance.
2. `tests/recording-screen-share-browser.mjs` — actual screen/camera/audio file verification, backend consent/authority checks, private playback/download, host-end and restart checks.
3. `package.json` — `test:recordings:screen` command.
4. `deployment/RECORDING_TRANSCRIPTION.md` — updated usage instructions.
5. This audit/report.

Run the new test against a built frontend with `npm run test:recordings:screen -- artifacts/qa/phase8-screen-build` (defaults to `frontend/dist` if no build path is supplied). It creates only local synthetic fixtures and requires the installed local Chrome, FFmpeg and test LiveKit binary. Test listeners and their owned SFU/browser processes are closed afterward; saved synthetic media/evidence remain under the uniquely created artifact folder.

## Public testing blockers and safe next step

The reason recording is unavailable in the current public environment is its deliberate disabled runtime and recording-route allowlist, not a demonstrated failure of shared-screen capture. Enabling it requires separate explicit approval plus a narrowly scoped isolated recording runtime/storage and route update, confirmation of worker access to the existing Cloud SFU, and capacity/security verification. Do not infer Cloud media/recorder connectivity from Cloudflare HTTP health.

Account-based admitted testers can use the existing consent flow. Booking-link guest recording remains blocked until its own consent flow is implemented and tested. No recording may start before consent and explicit host start. Public microphone/camera/screen capture, LiveKit Egress, real email/OTP, paid services and deployment remain unauthorized. The existing public server/tunnel, main environment, databases and saved media were preserved.

The fixed composite currently puts a shared screen first in an equal grid with cameras; there is no presentation-dominant layout, individual-track export, diarization or native pause/resume. Source/network limitations still apply to output quality. Optional local transcription is slower than real time for some language/model combinations.

## Final frontend browser recheck

**PASS**, exit 0, against the new isolated frontend build. All three lifecycle checks passed: normal stop, host ending during capture, and playback after restarting only the disposable test server. The screen-mode guidance was visible before requesting consent.

Evidence: `artifacts/qa/recording-screen-share-WFjjEF/results.json` and `artifacts/qa/phase8-screen-recording-browser-final.log`.

- Normal stop: `media/5a6723dd-880c-4395-ac93-180dfb0ac351.webm`, 486,354 bytes, 14.384 seconds.
- Host end: `media/6e4447c7-b02a-4524-919e-92dec79c9cfe.webm`, 470,817 bytes, 13.625 seconds.
- Both files decoded, displayed the screen changing from blue to purple plus both synthetic cameras, and retained both microphone frequencies. The actual Meeting Details player loaded 1280×720 video, advanced during playback and sought near the end. Authorized range/download and unauthorized member rejection passed. The original saved key and bytes were unchanged after restart.
- Final totals: **66 automated regression tests passed, 0 failed; one end-to-end browser test covering three real-media lifecycle checks passed, 0 failed**. TypeScript and production build passed. This is local synthetic recording evidence only.

The output-sample extraction uses the same asynchronous timestamp-aware FFmpeg resampling filter as the existing transcription pipeline; it does not alter saved recordings. No recorder/backend functionality or media encoding profile was changed.
