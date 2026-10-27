# Recording and transcription verification

Verified locally on 18 October 2026. No deployment, paid API, cloud resource, real email or SMS was activated. This report covers the existing recording phase only.

## Completed behavior

The existing authenticated Talk meeting, host/co-host authorization, consent screens, LiveKit subscriber recorder, private storage, database migrations, background jobs and meeting-details viewer were reused. Audio-only and audio/video segments include authorized consenting participants. Stop acknowledges promptly while saving continues independently. Everyone sees recording notices; late joiners consent before receiving room access, and withdrawal stops capture without ending the call.

Saved recordings have private authenticated playback, byte-range seeking, downloads, retention/deletion, audit events and automatic timestamped local Whisper transcripts. The existing details page provides participant information, search, timestamp seeking, TXT/PDF export and useful queue/retry/failure states. Pause/resume remains an honest stop/new-segment workflow with fresh consent. Mixed audio has **unattributed speakers**; no diarization or invented names were added.

## Causes and fixes

| Issue | Fix |
| --- | --- |
| Encoder inputs and browser shutdown could keep finalization alive | End generated tracks, await final MediaRecorder data and writes, sync/remux output, bound graceful shutdown and force only the owned Chromium tree. |
| Request completion could invalidate asynchronous database work | Finalization and jobs use independent database contexts. Stop returns HTTP 202 after its authorized state transition. |
| Renewable leases allowed hung work to remain active | Bound startup, complete saving, speech processing and cleanup; abort late work and reject stale results. |
| Restart left null/expired leases and inconsistent processing metadata | Reconcile unfinished capture and speech work; fail incomplete capture closed, delete partial files and retry durable jobs within limits. |
| Cloud retries could share temporary files or leave late uploads | Use cancellable per-attempt private inputs and re-arm durable cleanup for late upload acknowledgements/rejections. |
| PDF teardown and UI status polling could hide failures | Bound PDF rendering/owned-browser cleanup; avoid overlapping polls and expose recoverable status warnings. |
| Base-model Hindi was romanized and inaccurate | Retain the faster English model and install a separate checksum-pinned Hindi accuracy model. Automatic selection detects language before choosing the model. |

## Files modified

- Backend: `backend/src/recording-recorder.mjs`, `recorder-client.mjs`, `meeting-recordings.mjs`, `recording-transcriber.mjs`, `recording-storage.mjs`, `recording-exports.mjs`.
- Existing UI: `frontend/src/components/MeetingRecording.tsx`, `frontend/src/hooks/useMeetingRecording.ts`, `frontend/src/pages/MeetingHistory.tsx`.
- Tests: `tests/meeting-recordings.test.mjs`, `recording-processing.test.mjs`, `recording-model-selection.test.mjs`, `recording-storage-cloud.test.mjs`, `recording-exports-lifecycle.test.mjs`, `production-recordings.test.mjs`, `recordings-browser.mjs`, `meeting-moderation-browser.mjs`, `tests/helpers/live-meeting.mjs`.
- Scripts: `scripts/test-production-postgres.mjs`, `test-local-transcription.mjs`, `fetch-hindi-speech-fixture.mjs`, `setup-recording-transcription.mjs`.
- Configuration/documentation: `.env.example`, `package.json`, `deployment/RECORDING_TRANSCRIPTION.md`, this report.

Existing authentication, pre-join layout, effects, dashboard, branding and meeting architecture were preserved. No duplicate recording tables or authentication system were created. Existing SQLite migration 007 and PostgreSQL migration 005 were used.

## Actual media verification

Separate installed Chrome processes joined the real local LiveKit SFU through Talk authentication/session and signaling routes. Cameras and microphone inputs were generated fixtures; these are **real transport/encoding/decoding tests, not physical-device tests**. A public human speech sample was also sent through a browser microphone input, recorded through LiveKit and recognized by local Whisper.

| Evidence | Result |
| --- | --- |
| Audio segment | 8.656 seconds, 88,003 bytes; decoded audio contained both 440 Hz and 660 Hz participant signals above adjacent-frequency noise. |
| Audio/video segment | 30.063 seconds, 936,593 bytes; decoded frame contained 54,912 red and 55,255 blue camera-source pixels at 640×360, plus both participant audio signals. |
| Stop HTTP acknowledgment | 391 ms and 464 ms for two audio segments. |
| Complete saving after Stop | 7.753 s and 10.601 s. |
| Consent withdrawal | HTTP accepted in 3.471 s; capture finalized in 12.811 s; the meeting remained connected. |
| Late join | No SFU access before consent; successful join after consent. |
| Recording-to-transcript workflow | Real Whisper produced two English segments from recorded public speech. Search, no-results state, actual 8.0 s → 8.0 s playback seek, private Range/TXT/PDF, mobile width and audited UI deletion passed. |

Evidence: `artifacts/qa/recording-browser-results.json`, `recording-phase-browser.log`, recording screenshots and exported PDF. No headless browser roots remained after the completed browser tests. Measurements are observations on this machine, not latency guarantees.

## Actual speech recognition

| Case | Model / result |
| --- | --- |
| English | Official multilingual base model; 11.0-second public-domain JFK clip recognized in 11.914 seconds with two threads. Ordered timestamps and unknown speakers preserved. |
| Hindi | Official multilingual medium-q5_0 model; 22.7-second human Hindi FLEURS clip recognized in **771.075 seconds (12m51s)** with two threads. Reference comparison: **6.83% character error and 22.86% word error**. Timestamped Hindi script was produced; speakers remained unknown. |

Hindi TXT and PDF were generated through the existing exporter from that actual recognized output. This is not an accuracy guarantee: the larger model still makes errors, and mixed-language/noisy/long meetings need further evaluation. Earlier base/small-model and prompt experiments failed the Hindi quality check; their artifacts were retained, and the unsuccessful prompt change was removed.

The English script and Hindi backend-engine comparison were separate genuine recognition executions. The combined JSON report describes those executed runs; combining their evidence does not rerun recognition. The complete LiveKit-to-Whisper browser workflow was tested in English. Hindi recognition/export and automatic model-routing tests were separate checks. No claim is made that a Hindi meeting was tested end to end through LiveKit.

Sources: [official whisper.cpp samples](https://github.com/ggml-org/whisper.cpp/tree/v1.9.2/samples), [Google FLEURS, CC-BY-4.0](https://huggingface.co/datasets/google/fleurs). The Hindi downloader reads a bounded archive prefix and verifies the clip checksum. Model, executable and license downloads are pinned and cached; no speech is uploaded to a service.

## Final automated results

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Backend authentication, meetings and avatars | 88 | 0 | 0 |
| Recording processing, jobs, privacy, exports, cloud adapter and model selection | 48 | 0 | 0 |
| Frontend meeting/reaction/avatar/background/effects/password tests | 35 | 0 | 0 |
| Actual local PostgreSQL 16 integration | 17 | 0 | 0 |
| **Total Node test cases** | **188** | **0** | **0** |

The original combined backend run passed 130 cases, including 42 recording cases; the final recording run passed those 42 plus six new model-selection/cancellation cases. These overlapping runs are not double-counted above.

Three additional real-browser scripts passed: recording/transcript workflow, existing pre-join/audio/video/reconnection/cleanup, and backend-enforced moderation. Two separate actual human-speech recognition cases passed. TypeScript/lint, production build, bounded fixture download and cached local installer checks passed.

Moderation checks cover waiting-room privacy, admission/denial, actual SFU media restrictions/restoration, co-hosts, reconnection, lock, raised hands/reactions, removal, opaque-token replay rejection, mobile controls, leaving and ending for everyone. The test now waits for actual SFU permission propagation and uses the current reaction-picker location. It can exercise the existing visible Rejoin action once after a transport failure; the final passing run did not need that recovery.

See `artifacts/qa/recording-phase-final-results.json` and the corresponding TAP/log/JSON files. Database/storage/provider fixtures are explicitly identified in tests. Authentication regressions did not send real email/SMS or perform real Google-provider sign-in.

## PostgreSQL and security

An isolated disposable PostgreSQL 16 container verified existing migrations, consent rows, sessions, private Range/TXT access, co-host revocation, jobs/transcripts, fresh-application/pool restart, crashed-capture/speech recovery, retention, deletion and audit records. The final run passed all 17 cases in 49.14 seconds. Its container was removed. This verifies actual PostgreSQL persistence, not a cloud database deployment. Media/STT providers were fixtures in that database suite.

Private content is protected by current backend authorization and CSRF/session controls. Read-only recording tokens remain room-restricted. Local files are outside static assets; cloud objects are proxied after authorization. Real GCS permission/network validation was not performed. Cloud adapter tests used injected streams and metadata. Credentials were kept private.

## Performance and remaining production limits

- One globally leased speech job, below-normal CPU priority where supported, two default threads capped at four, capture-first scheduling and a 15-second grace period reduce contention. These are not CPU reservations.
- Startup is bounded at 90 s, complete saving at 180 s, speech processing at 63 minutes; worker flush/browser/PDF cleanup have shorter deadlines. Work fails explicitly instead of retaining an infinite active lease.
- Hindi accuracy mode was approximately 34× real time on this machine. **Timely long Hindi meeting transcription is not verified and is unsuitable on this CPU.** Long recordings can reach the processing deadline. Benchmark an appropriately sized persistent worker or approved GPU infrastructure before production use.
- Maximum segment duration/size, owner quota, consent, retention and video-participant limits remain enforced. A sudden machine failure cannot recover encoder data that was never flushed.
- Production still needs approved persistent compute, platform-matching Chromium/FFmpeg/Whisper, the model files, existing PostgreSQL migrations, private durable storage and deployment-specific sandbox/permission/load checks. Production capture remains opt-in. No GCS bucket, Egress service or paid infrastructure was provisioned.
- No reliable diarization, native provider pause/resume, live captions, AI summaries, physical-device certification or large-meeting throughput claim is made. The Windows setup helper is platform-specific. LiveKit remains loaded on demand; no speech SDK/model was added to landing/authentication bundles.

## Local manual workflow

Open **http://localhost:3001/meeting-history** (sign in if needed). The Talk development server and existing local LiveKit server are available; no public deployment was made.

1. Choose **New meeting**, enter a title and join using the existing pre-join camera/microphone tests.
2. Copy the meeting link to another browser/device and sign in with another Talk account. Admit that account if approval is required.
3. As host/co-host, open **More options → Recording & transcription**. Choose audio or audio/video, English/Hindi/detection and retention; request consent.
4. Each participant accepts. Click **Start Recording**, speak, then **Stop Recording**. Saving continues in the background while the meeting remains usable.
5. Open the meeting's **View details** from Meetings. Play the private segment, then open **Transcript** when processing completes. Hindi can take substantially longer than the call segment on this CPU.
6. Search text, click a timestamp to seek, download recording/TXT/PDF, or delete the segment and transcript. A new segment requires fresh consent.

If the app is stopped later, run `npm run meeting:server` and `npm run dev` from the repository. Run `npm run recording:setup` to restore the verified local engine/models. Production installation requires its own approved setup. This phase stops here; recording AI summaries or another development phase were not started.
