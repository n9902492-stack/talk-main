# Talk light reference frontend

Implemented 23 October 2026 from the supplied `talk_light_mode_dashboard.html`, `talk_video_call.html` and three light-theme PNG references. The supplied HTML was treated as design input; its demo scripts and CDN dependencies were not incorporated.

Follow-up dashboard navigation revision: removed the overview top bar and replaced it with the supplied 326px left sidebar. Dashboard, Bookings, Meetings and Meeting History retain their existing routes. The bottom collapse control switches to an 80px icon rail and saves the preference locally. Account/profile/sign-out actions are available through My workspace. Mobile uses a dismissible sidebar with keyboard focus handling. The call and meeting-library layouts are unchanged by this revision.

## Scope

- Dashboard and meeting library: Inter body text, Plus Jakarta Sans headings, light gray canvas, blue gradient, white cards, reference navigation, tabs, filters and typography. Decorative dashboard portraits are local assets.
- Live call: default light theme with optional dark theme, gold accents, compact device controls, Chat/People sidebar, real participant tiles and actual recording indicators. Existing settings, reactions and whiteboard remain accessible through More.
- Call dimensions verified at 1408×768: 60px header, 330px sidebar, 72px dock and first tile at y=76px.
- Content and counts come from Talk's existing state. Reference participant photos, messages, recordings and names are not inserted into real meetings. Live captions remain disabled because a live-caption service is not configured.

Changed UI sources: `Dashboard.tsx`, `MeetingsHub.tsx`, `LiveMeeting.tsx`, `MeetingPanels.tsx`, `MeetingCanvas.tsx`, `index.css`; added `workspace-reference.css`, `call-reference.css`, and `public/assets/light-reference/` portraits. Pre-change copies are under `artifacts/backups/light-reference-*`.

## Validation

- TypeScript / `npm run lint`: PASS.
- Isolated production build: PASS, with the existing bundle-size warning. Output: `artifacts/qa/light-reference-build`.
- Focused meeting experience, history and link unit tests: 18 passed, 0 failed, 0 skipped.
- `light-workspace-browser.mjs`: PASS for reference typography, actual fixture counts/filtering, navigation, join dialog and mobile overflow.
- `meetings-hub-browser.mjs`: PASS for database-backed history, authorization, search, categories, cards/list at 1440/768/390/320px, join/create dialogs, private playback, transcript search/seek and exports using synthetic content fixtures.
- `meeting-reference-browser.mjs`: PASS with two browser participants on the local LiveKit SFU: camera frames, microphone packets, chat/unread/plain-text safety, native tab screen capture decoded remotely, theme changes, reference geometry, hand controls, settings, mobile sidebar and leaving. Camera/microphone sources were synthetic; physical devices and a six-person media load were not tested.

Screenshots and logs are in `artifacts/qa/light-*` and `artifacts/qa/meeting-reference-*`.

## Local review

- Dashboard: http://localhost:3001/dashboard
- Meetings: http://localhost:3001/meeting-history
- Use Test audio & video or Join meeting to reach the existing pre-join and real call flow.

No backend or environment configuration was modified. No real email, Gemini request, deployment, public-tunnel restart or main-database migration occurred. The separate public booking frontend was not rebuilt or replaced.
