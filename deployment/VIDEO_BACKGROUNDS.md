# Camera background effects

Camera backgrounds extend the existing camera path without adding recording, transcripts, AI avatars, paid services or a new meeting/authentication system. Appearance adjustments, video filters and studio lighting now share this same processing pipeline; see [VIDEO_EFFECTS.md](VIDEO_EFFECTS.md) for those controls and their limitations.

## Local usage

Open http://localhost:3001/dashboard and choose **Start a session**. On the existing pre-join screen, enable the camera, expand **Backgrounds**, then choose **None**, **Blur**, **Office**, **Nature**, **Soft studio**, **Coast** or an uploaded image. Blur strength ranges from 4 to 24. The existing camera preview shows the processed frames; audio tests, device selection, names and Join session remain in place.

Inside the meeting, open **Settings → Backgrounds**. Its live preview uses the same local track as the outgoing camera. The **Audio & video** section retains device selectors and avatar settings. Effects apply only to camera video, never screen sharing or microphone audio.

## Processing and lifecycle

`TalkCameraProcessor` in `frontend/src/lib/cameraBackground.ts` implements LiveKit's TrackProcessor contract and delegates segmentation/composition to pinned `@livekit/track-processors` 0.8.2 and MediaPipe Tasks Vision 0.10.14. The MediaPipe Selfie Segmenter float16 v1 model runs locally. WASM/model files are served from the app's own `/vendor/backgrounds/`; camera frames are not sent to a segmentation cloud API. LiveKit still transports the resulting video to meeting peers as usual.

The pre-join preview processes a clone of the existing capture; it does not acquire a second camera device or replace the original capture/audio tests. Cleanup stops the clone and its processor. The original capture is handed to LiveKit through the existing join flow. A selected effect is prepared on a LocalVideoTrack **before publication**; failed initialization leaves the camera off, rather than silently publishing raw video. The upstream processor's initial unmodified warm-up frame is explicitly disabled in this pinned adapter. Effects are visual aids, not a guarantee that every background pixel will be concealed.

During a meeting the active processor switches blur/images in place. Background None disables segmentation/replacement while preserving any selected appearance/filter/studio effects. Reset All Effects destroys processing and restores the original camera track. Camera-off suspends processing; enabling an effected camera recreates the camera publication through existing LiveKit APIs with processing configured before publication. Device changes use LiveKit's processor restart contract. Leaving, host removal/end, source exhaustion and unmount stop capture/processors using the existing meeting cleanup path. Profile/meeting permissions and host publishing restrictions are unchanged.

Capture frame rate is requested at at most 24 FPS while processing; a camera may reject that constraint. The coordinated transformer skips frames and caps input width independently, starting at 24 FPS / 1280 px. Sustained slow processing reduces those limits to 15 FPS / 960 px and then 10 FPS / 640 px. At the lowest level, optional appearance smoothing and Soft Glow neighborhood detail are disabled. The panel reports measured processing time and reduced-quality status; see [VIDEO_EFFECTS.md](VIDEO_EFFECTS.md#performance-and-cleanup) for thresholds. Segmentation uses WebGL2/MediaPipe and can block the main thread on slower devices. Unsupported browsers keep normal-camera functionality, with unsupported effect choices disabled. Low light, fine hair, fast motion, occlusion and multiple people can reduce mask quality. Physical mobile GPU/thermal performance must be checked on target devices; responsive browser emulation is not that hardware test.

## Preferences, uploads and storage

The selected preference is saved per Talk account in this browser's localStorage, without credentials. It carries a mode, blur strength and an allowlisted preset ID or custom-image version, never an arbitrary external URL. Anonymous pre-join users have a separate guest preference. Preferences do not sync between devices.

One custom image per account is stored in the existing database's `account_backgrounds` table. SQLite migration **006** applies on local startup. PostgreSQL migration **004** must be applied through the existing production migration command before deploying this version. Existing import tooling includes the table and accepts older backups without it. No bucket or cloud resource is created.

The upload endpoint reuses existing session, Origin, CSRF and durable per-account/IP rate-limit checks (20 updates per account/minute, 100/IP/minute). Still JPEG, PNG and WebP only; maximum 2 MiB input / 10 million pixels; signatures and decoded formats must match. Sharp normalizes orientation, resizes within 1920×1080, removes metadata and re-encodes WebP, capped at 1 MiB. SVG/GIF/animated or malformed content is rejected. New uploads replace the previous image. Only the account owner can retrieve the original custom background through authenticated `/api/auth/profile/background/image`; peers receive composed camera pixels. Responses are `no-store` and `nosniff`. The existing avatar validator delegates to the same normalization helper with its original square/size policy.

## Assets and licenses

Four original CC0 illustrations are in `frontend/public/assets/backgrounds/`, reproducible with `node scripts/create-background-assets.mjs`. They do not copy Google Meet backgrounds. MediaPipe runtime and Google's segmentation model use Apache 2.0; the license, notices and checksums are under `frontend/public/vendor/backgrounds/`. Runtime files can be copied from the pinned npm dependency with `node scripts/prepare-background-runtime.mjs`; the model URL is recorded in NOTICE.txt. Review license/checksum changes whenever updating these dependencies.

Browser tests use the NASA public-domain Eileen Collins portrait plus a generated checkerboard camera feed, not personal camera images. Its source/license are documented in `tests/fixtures/NASA-PORTRAIT-LICENSE.md`. This fixture is not shipped in the website.

## Verification

```sh
npm run test:backgrounds
npm run test:avatars
npm run test:meetings
npm run test:auth
npm run lint
npm run build
npm run test:backgrounds:browser
npm run test:reactions:browser
npm run test:meetings:experience
npm run test:meetings:moderation
npm run test:meetings:browser
```

Browser tests require the existing local LiveKit server. They use separate Chrome processes, actual segmentation and real local LiveKit transport, with generated camera/microphone input and test identity verifiers. They compare camera/remote pixel measurements for blur, original foreground retention, replacement and restoration, rather than accepting a CSS-only visual change. Screen captures, pixel evidence and results are written under ignored `artifacts/qa/`. No real provider login, SMS or email is sent by these tests. Production PostgreSQL integration requires a separately configured test database; a skipped check is not production verification.
