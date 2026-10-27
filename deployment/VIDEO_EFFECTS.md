# Video filters, appearance and studio effects

These controls extend Talk's existing camera background settings and published LiveKit camera track. They do not add recording, transcription, animated avatars, cloud image processing, a second authentication system, or paid resources. The Talk dashboard, pre-join controls and meeting layout remain in place.

## Try it locally

1. Open **http://localhost:3001/dashboard**, sign in and choose **Start a session**.
2. Enable the camera on the existing pre-join screen and expand **Backgrounds**. This existing disclosure now includes **Backgrounds**, **Appearance**, **Video Filters** and **Studio Effects** sections.
3. Choose an effect and inspect the existing camera preview. Join the meeting using the existing **Join Session** action.
4. In a meeting, open **Settings** and select one of the same sections. The settings preview attaches to the same local LiveKit camera track that is published to peers.
5. Join the same authorized room from a second browser or device. Inspect the remote participant's video, rather than only the local preview.

Effects change camera video only. Microphone audio and screen sharing keep their existing paths. Camera-off tiles continue to display the participant's selected avatar. Device changes, host publishing restrictions and meeting access remain under the existing controls.

## Controls

| Section | Controls and behavior |
| --- | --- |
| Backgrounds | Existing None, adjustable Blur, Office, Nature, Soft studio, Coast and private custom uploads. See [VIDEO_BACKGROUNDS.md](VIDEO_BACKGROUNDS.md) for upload validation, storage and licenses. |
| Appearance | Brightness and contrast 50–150% (default 100%); saturation 0–200% (default 100%); warmth −50 to 50 (default 0); subtle skin smoothing 0–30% (default 0%). Sliders update the actual camera frames. |
| Video Filters | None, Black & White, Warm, Cool, Vintage, Cinematic, Soft Glow, High Contrast and Natural. Original illustrated thumbnails show approximate color treatments; the live camera preview shows the actual result. |
| Studio Effects | Automatic lighting enhancement, Low-light adjustment, Soft portrait lighting, Subtle appearance enhancement and native Automatic camera framing where the current browser **and actual camera** permit it. |

**Reset to Default** in Appearance resets only the appearance sliders. Selecting **None** under Video Filters removes the filter while preserving background, appearance and studio choices. Selecting **None** under Backgrounds removes background segmentation/replacement while preserving other effects. **Reset All Effects** clears all four sections and restores regular camera video.

The checkboxes and sliders are labeled for keyboard and screen-reader use. Settings wrap on narrow screens and remain in the existing scrollable meeting panel.

## What the processing does

`frontend/src/lib/videoEffects.ts` defines the filter allowlist, neutral defaults, normalization, finite numeric bounds and capability checks. `BackgroundPreference.effects` adds these options to the existing background preference; a separate preference or media system is not introduced. `BackgroundSettings.tsx` is shared by pre-join and in-meeting settings.

`TalkCameraProcessor` in `cameraBackground.ts` owns one coordinated LiveKit TrackProcessor pipeline. An input camera frame passes through optional existing MediaPipe background segmentation/composition and then optional `VideoAppearanceRenderer` WebGL2 grading. One processed output feeds LiveKit. Switching compatible effects updates the current transformer instead of acquiring a competing camera or publishing parallel video tracks. The pre-join preview uses a capture clone and hands the existing original capture to the current join flow.

Appearance and the new studio lighting use local GPU image processing, **not an AI face or beauty model**:

- Brightness, contrast, saturation, warmth and presets are applied in one GPU grading pass.
- Smoothing uses a broad skin-color heuristic and edge-aware neighboring samples. It does not detect or track faces, reshape features, or promise consistent skin isolation. Similar-colored objects may also be softened.
- Automatic lighting samples a 32×18 image at most every 500 ms, smooths measured luminance and adjusts exposure within bounded values.
- Low-light adjustment lifts shadow detail according to the same luminance measurement. It cannot recover detail that the camera did not capture.
- Soft portrait lighting is a fixed, center-weighted light adjustment. It does not locate a person or follow a face.
- Subtle appearance enhancement combines gentle tone/color adjustment with restrained smoothing.

Background removal continues to use the existing local MediaPipe segmentation model, documented separately in [VIDEO_BACKGROUNDS.md](VIDEO_BACKGROUNDS.md). No additional model or package was installed for these new controls. Frames are processed on the device, then the resulting video is transported to meeting peers through the existing LiveKit connection.

## Native framing and browser limits

Automatic camera framing is enabled in the picker only when the actual original camera track reports a supported `faceFraming` or `autoFraming` capability and the browser recognizes that constraint. Recognizing the constraint name alone is insufficient. The setting is checked again when applying it, and enabling is accepted only if the camera reports it enabled afterward. A processed/generated output track is not used to claim physical-camera capability.

The control is disabled when that camera/browser capability is unavailable. No Talk face-tracking, crop-tracking model, digital zoom imitation or AI framing fallback is implemented. Native framing depends on hardware, drivers and browser support and may remain unavailable on many devices.

Camera effects require a secure context (**localhost** is valid for local development), `OffscreenCanvas`, `VideoFrame`, WebGL2 and a supported LiveKit processing/canvas path. Background segmentation additionally requires the existing background processor's capabilities. A capability probe does not guarantee sufficient GPU memory or sustained performance. Unsupported devices retain the regular camera option; effect initialization failures show actionable errors instead of silently publishing an unprocessed camera while an effect is selected.

Physical webcam appearance, low-light quality, mobile GPU load, thermal behavior and battery usage need checks on target hardware. Desktop browser responsive emulation is a layout test, not a physical mobile performance test. Segmentation may struggle with hair, motion, occlusion or multiple people; effects are not a guarantee that private surroundings remain concealed.

## Performance and cleanup

The coordinated pipeline starts with a maximum processed rate of **24 FPS** and a maximum frame width of **1280 px**. Capture requests also ask for at most 24 FPS, but cameras may reject that request. Input frames are skipped to respect the processing rate; frames wider than the current limit are resized while retaining their aspect ratio before segmentation/grading.

Sustained slow processing reduces complexity in stages:

| Processing level | Maximum processed FPS | Maximum frame width | Optional detail |
| --- | --- | --- | --- |
| Normal | 24 | 1280 px | Smoothing and Soft Glow detail available |
| Reduced | 15 | 960 px | Reduced rate and frame size |
| Lowest | 10 | 640 px | Optional smoothing and Soft Glow neighborhood detail disabled |

The transformer uses a smoothed per-frame processing time. Twenty accumulated slow frames trigger a reduction, using 48 ms at the normal level and 80 ms at the reduced level. This is a responsiveness safeguard, not a guaranteed delivered frame rate. Network conditions, encoder load and device performance also affect remote video. Complexity reductions last for that processor instance and do not overwrite the user's saved effect choices. The panel reports measured processing time and a reduced-quality message when applicable.

Camera-off suspends processing. Re-enabling an effected camera prepares processing before publication through the existing LiveKit flow. Camera switching uses the processor restart contract. Leaving, source exhaustion, host removal/end and unmount follow the existing media cleanup path. The processor stops owned clones and output tracks, destroys segmentation and GPU resources, and cancels stale initialization work. Failed partial initialization also stops allocated generators/canvas streams. Selecting Reset All Effects restores the unprocessed camera path; runtime errors offer reset/camera-retry guidance.

## Preferences, privacy and deployment

The complete normalized preference is saved under the existing per-account `talk-background:<accountId>` browser localStorage key; guest preferences remain separate. Choices persist between meetings in that browser and do not sync across devices. The preference contains allowlisted settings and a custom-image version, not credentials, external script URLs or arbitrary image URLs.

Custom background uploads continue to use the existing authenticated backend validation and private database storage. This phase adds no database migration, new backend endpoint, cloud service or npm dependency. Existing original background assets and their licenses remain unchanged; the filter thumbnails are original inline vector illustrations. No deployment, paid resource creation, real SMS or email delivery is required to test these effects locally.

## Verification

Start the existing local LiveKit service and development server using the meeting setup described in [MEETINGS.md](MEETINGS.md). Browser suites serve the production frontend build, so rebuild before running them:

```sh
npm run test:video-effects
npm run test:backgrounds
npm run test:avatars
npm run test:meetings
npm run test:auth
npm run lint
npm run build
npm run test:video-effects:browser
npm run test:video-effects:lifecycle
npm run test:backgrounds:browser
npm run test:reactions:browser
npm run test:meetings:experience
npm run test:meetings:moderation
npm run test:meetings:browser
```

The video-effects browser suite launches **two actual Chrome processes** connected through the existing local LiveKit server. Generated camera frames use a dimmed public-domain NASA portrait plus synthetic colored/checkerboard regions. Camera hardware and identity providers are fixtures; GPU frame processing, Talk's backend/session path, media encoding, LiveKit transport and remote decoding are real. The suite measures processed local and remote pixels for appearance, filters, studio lighting and composition with original/custom backgrounds. It also checks switching, camera cleanup, avatars, reactions, saved preferences and mobile layout. These are not CSS-only effects or a simulated media connection.

Ignored `artifacts/qa/video-effects-results.json` records evidence and limitations; screenshots are written beside it. Native framing can only be tested on a camera that exposes the capability, so an unsupported test browser verifies the disabled control rather than claiming framing movement. Generated-media browser tests do not establish physical-webcam or physical-mobile performance, successful real provider sign-in, production deployment or production PostgreSQL behavior. Report skipped checks separately from passes.

## Verified local evidence — 16 October 2026

The successful `artifacts/qa/video-effects-results.json` run used two actual Chrome processes, Talk's local API/SQLite sessions and real local LiveKit transport. Generated camera and identity fixtures were used; no physical webcam or mobile hardware was tested.

Remote decoded-frame measurements confirmed that peers received processed pixels: neutral average luminance was **93.1**, brightness adjustment raised it to **125.6**, and Black & White reduced the measured chroma from **59.3** to **0**. Automatic lighting produced luminance **108.8** on the dim fixture. Office and custom backgrounds combined with grayscale both measured **0** chroma; restoring the custom background's color yielded average RGB **222.5 / 73.2 / 64.0**. These are fixture measurements, not universal quality targets.

The latest panel report was approximately **13 ms per processed frame**, with reduced processing quality observed during the run. The remote sample decoded approximately **8.9 FPS** using a **15 FPS generated input** and software GPU testing support. This short software-rendered sample is not a physical-device performance benchmark or a promised production frame rate. Native framing was unavailable in the test camera/browser and its control was correctly disabled.

Completed automated checks: **5 video-effects unit tests**, **10 existing frontend unit tests**, **62 authentication tests**, **19 meeting backend tests**, **7 upload tests** and **3 production unit tests** passed. Native-framing capabilities and restart-cancellation ordering use API/lifecycle stubs in the unit tests; actual frame processing is tested separately below. **One production PostgreSQL integration check was skipped**.

The separate lifecycle browser suite also passed. It delays or fails model delivery to verify initialization cancellation, checks the SFU has no raw camera publication after an effect fails, preserves microphone audio, and restores real remote camera video after Reset All. It forces the canvas fallback and measures grayscale locally and through LiveKit (chroma **202.51 → 0**). Joining retains the original camera: video capture count stayed **2 → 2**, and Stop devices/Leave ended every owned capture/output. The preview uses a separate presentation stream so LiveKit attachment cannot mutate the original capture stream. Evidence is in `artifacts/qa/video-effects-lifecycle-results.json`.

Existing browser regressions also passed: background blur/replacement/custom upload, pre-join camera/microphone and speaker/recording tests, two-way media, screen capture with remote pixel checks, data-channel chat, participant grids with 4/9 connections, reconnection, moderation enforced by the backend/SFU, reactions, avatar persistence/uploads and mobile panels. Hardware capture and identity verifiers are fixtures; the browser media processing, backend moderation and local LiveKit transport are real.
