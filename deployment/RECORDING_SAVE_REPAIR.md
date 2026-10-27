# Recording save repair — 22 October 2026

## Root cause and scope

The existing development database had one failed capture (`recorder_failed`, zero saved bytes) and one request still awaiting consent. The failed capture's audit sequence reached `client_bundle`, reported `failure: Build failed with 2 errors:`, then persisted `capture_failed`. No completed recording/file existed for that segment to display in Meeting Details.

Reproducing the original esbuild invocation in the restricted runtime returned two errors: parent-directory access denied and failure to resolve the recording client entry point. The identical source built successfully in a normal local process (509,875-byte JavaScript bundle). This was a recorder startup/build-permission failure before capture, not a successful recording hidden by the frontend. The parent-directory restriction belongs to the execution environment; the repair does not relax that restriction.

The configured private recording directory is `C:\Users\ss828\Downloads\talk-main\data\recordings`. An exclusive temporary write, sync, read and cleanup probe passed. Approximately 188 GB disk was available. Existing failed/pending records and existing media were preserved. A zero-byte failed capture cannot be recovered as a video.

## Narrow repair

- `backend/src/recording-client-bundle.mjs`: source/dependency-fingerprinted, content-checked prepared recorder artifact; sanitized explicit preparation failure. No meeting data or credentials are bundled.
- `scripts/prepare-recording-client.mjs`: `npm run recording:prepare`, offline build into ignored `backend/dist/recording`. Prepared successfully locally. Unrestricted runtimes retain the existing in-memory compilation fallback.
- `backend/src/recording-recorder.mjs`: load/validate client before opening Chromium or a partial media file. Capture, mixer, encoder, FFmpeg and existing LiveKit token implementation reused.
- `backend/src/meeting-recordings.mjs`: preserve actionable bundle error; distinguish stopping from processing; check committed nonempty media size before completed metadata; expose latest result only to authorized managers.
- `frontend/src/hooks/useMeetingRecording.ts`, `frontend/src/components/MeetingRecording.tsx`: show processing, persisted readiness and saving failures. Consent and recording controls retain their existing behavior.
- `frontend/src/pages/MeetingHistory.tsx`: completed recordings display Ready; existing private playback/download unchanged.
- `package.json`: preparation and focused real-media test commands, bundle regression coverage.
- `tests/helpers/live-meeting.mjs`: optional isolated persistent test database and recording configuration.
- `tests/recording-save-browser.mjs`, `tests/recording-bundle.test.mjs`, `tests/meeting-recordings.test.mjs`: real-media lifecycle and targeted failure/state/persistence regressions.
- `deployment/RECORDING_TRANSCRIPTION.md`: preparation and lifecycle documentation.

No database schema change or manual database migration was needed. No existing recording was relocated or overwritten.

## Actual media verification

Run: `node --import ./tests/helpers/cloud-egress-guard.mjs tests/recording-save-browser.mjs`.

The test used two actual Chrome participants, a loopback LiveKit SFU, real MediaRecorder/FFmpeg, synthetic red/blue camera sources and distinct 440/660 Hz microphones. The test authenticated fixture identities through the isolated test backend, checked required consent, used the existing recording buttons, then decoded the saved media. It did not use simulated media files returned by an API.

Latest evidence: `artifacts/qa/recording-save-O8vru8/results.json`.

- Normal stop: 482,524-byte WebM, 7.661 seconds captured; both camera colors and microphone frequencies verified. Every packet decoded with FFmpeg. The exact recording ID appeared in Meeting Details and its HTML video player advanced during playback.
- Ending the meeting while recording: 438,035-byte WebM, 7.246 seconds captured; both participant video/audio signals verified, visible and played in Meeting Details.
- An injected storage-write failure persisted Failed, showed an alert and denied playback; subsequent genuine capture succeeded.
- The backend/server, browser sessions and SQLite handles were closed and recreated against the same isolated on-disk database. The original recording retained its exact key/byte count, appeared under its exact recording ID and played again.
- Ordinary participant playback was denied; authorized download succeeded.
- Screenshots: `normal-stop-details.png`, `host-ended-details.png`, `after-restart-details.png` in the same evidence directory. Restart playback screenshot visually inspected.

The synthetic media remains only in the QA directory and test database. It was not inserted into the user's normal meeting library.

## Automated checks

- Recording, worker, file storage, consent, lifecycle, persistence, token restrictions, meeting management and prepared bundle: **74 passed, 0 failed** (`recording-repair-regression.tap`).
- Transcript revisions, AI foundation, whiteboards/intelligent whiteboards and password reset: **58 passed, 0 failed** (`recording-repair-features.tap`).
- Authentication and prepared-bundle checks: **65 passed, 0 failed** (`recording-repair-auth.tap`). Two bundle tests overlap the 74-test group; totals are not additive.
- Frontend meeting history, meeting experience and effects helpers: **15 passed, 0 failed** (`recording-repair-frontend.tap`).
- TypeScript: `npm run lint` passed.
- Production-style frontend build to isolated `artifacts/qa/phase10-build`: passed.
- One initial backend run had a transient fixture HTTP fetch failure before the restart scenario setup; the full subsequent recording/meeting run passed all 74 tests.

## Manual verification and limits

Talk is running at http://localhost:3001 (also http://127.0.0.1:3001); sign-in and backend configuration returned HTTP 200. The existing local SFU was started on loopback port 7880. Private recording APIs reject unauthenticated access. Local auth uses the existing `data/talk.sqlite`; test identities/media stay separate.

Cancel any obsolete pending consent request before beginning a fresh segment. All connected participants must explicitly consent. Failed captures with no encoded media cannot be reconstructed. Tests used synthetic media and short captures; physical-device and long-duration certification are not claimed. PostgreSQL deployment was not exercised or modified. Local Whisper implementation and configuration were preserved; real speech recognition was not rerun for this capture-save repair.

Gemini remained disabled; no Google inference requests, paid services, deployments, changes to `.env.tunnel-test.local`, or public tunnel restarts occurred. No recording was enabled in the intentionally restricted public test runtime.
