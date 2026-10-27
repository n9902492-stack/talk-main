# Recording audio/video synchronization — 22 October 2026

The existing saved user video was inspected locally for timing metadata only. Its video spanned approximately 20 seconds, but decoded audio contained 10.98 seconds of samples spread across that timeline, with 155 audio gaps exceeding 25 ms. Its recording audit also showed the silent Web Audio clock advancing much less than capture wall time. Playback was exposing gaps already present in the file.

The server recorder used the default interactive AudioContext buffer with Chromium's silent software sink. On this Windows runtime, small render quanta could fall behind the software timer. Controlled silent clock tests reproduced the difference: the default buffer advanced approximately 4.37 seconds over 5.01 seconds of wall time; `latencyHint: 'playback'` advanced approximately 5.013 seconds over 5.013 seconds after warm-up.

## Change

- `backend/src/recorder-client.mjs`: use the playback-sized Web Audio buffer; retain the silent sink and existing remote-track capture, mixing, consent, encoding and FFmpeg pipeline. Add capture/audio elapsed-time diagnostics to the private recording audit.
- `backend/src/recording-recorder.mjs`: recheck the source-fingerprinted prepared client per segment instead of retaining a process-lifetime JavaScript bundle.
- `tests/recording-sync-browser.mjs`: synchronized generated flashes and beeps through real local LiveKit, real browser capture and real saved-media decoding/playback.

The private prepared recorder artifact was rebuilt with `npm run recording:prepare`. No existing recording was overwritten, shifted, re-encoded or uploaded. No microphone/camera belonging to the server computer was opened. No audible playback was introduced into the server recorder.

## Verification

Evidence: `artifacts/qa/recording-sync-46GDwS/results.json`.

- Two isolated authenticated browser participants; synthetic synchronized camera flashes and 440 Hz beeps; loopback-only LiveKit; separate test database/storage; transcription disabled for this timing test.
- Saved video: 617,881 bytes, 20.357 seconds capture wall time.
- Audio: 20.16 seconds of actual samples across a 20.362-second timestamp span, compared with 10.98 seconds across about 20 seconds in the affected existing file.
- Ten visible flashes and ten audible pulses survived real WebRTC capture. Matched interior pulse offsets stayed between approximately -140 ms and +7 ms, with under 200 ms spread. Audio clock lag stayed below the test's 250 ms limit.
- The actual saved video also played through the authorized Meeting Details browser player.
- Recording bundle, worker lifecycle and meeting recording regressions: 37 passed, 0 failed (`artifacts/qa/recording-sync-regression.tap`).

## Limits

This correction applies to new recordings. Audio samples absent from an old file cannot be recreated. Existing recordings were preserved. The pulse test verifies a short local fixture recording under the observed workload, not every device, network or long-meeting load. Timing diagnostics support investigating any remaining machine-specific delay. LiveKit Cloud/public tunnel settings, recording consent, transcription behavior and Gemini activation were not changed.
