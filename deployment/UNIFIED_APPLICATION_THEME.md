# Shared Talk application theme

Updated 23 October 2026. This supersedes the earlier 326px sidebar and independent page styling recorded in LIGHT_REFERENCE_FRONTEND.md.

## Implemented

- Shared `WorkspaceShell` for Overview, Bookings, Meetings, Meeting History and private meeting details. One navigation menu, active route, account/profile actions, collapse persistence and mobile drawer replace duplicated headers/sidebars.
- Inter for body and controls; Plus Jakarta Sans for headings. Shared page headings are 28px desktop / 24px mobile, sections 18px, cards 16px, body 14px, controls 13.5px and captions 12px. Sidebar navigation is 14px, with a 248px expanded / 72px collapsed rail.
- Shared blue `#1679C4`, white cards, `#F5F5F5` page backgrounds, `#171C24` text and `#667085` secondary text across public pages, authentication, scheduling, recording details, device test/pre-join, call controls and whiteboard chrome. Dark call mode retains its contrast; semantic errors/mute/leave colors and saved canvas-object colors are preserved.
- Existing auth animations and Earth scene remain intact. Template preview, consent, insertion, drawing and persistence use the existing whiteboard implementation. No AI provider was activated.

## Bookings layout root cause

The old `.scheduler` grid still declared a 220px sidebar column after that sidebar moved into the shared shell. Its only remaining child, the booking form, could occupy the narrow first column. The global theme override masked this in a newly loaded build, but an already-open browser tab could still lack the new body theme class.

The scheduler now owns a block layout with a full-width main element, independent of theme activation. Application startup and the shared shell also activate the theme for existing development tabs. The browser test removes the body theme class and verifies the booking form still occupies the available width.

## Verification

- TypeScript and isolated production build passed.
- 21 focused meeting/history/link/scheduling-client unit tests passed.
- Application theme browser checks passed across landing, webinars, sign-in/up, password reset, phone sign-in, Overview, Bookings, Meetings, private meeting details and pre-join, including mobile routing.
- Workspace browser checks passed: collapse/expand, persisted preference, account/profile access, mobile focus, real fixture counts, filters and join dialog.
- Meeting-library regression passed with actual private HTTP/database/media fixtures: protected recording playback, transcript search/seeking, exports, filters and responsive cards/list.
- Authentication visual/motion/navigation suite: 14 groups passed with mocked Google SDK. It verifies the same Earth scene, reversible slide, drafts, focus and reduced motion.
- Whiteboard browser regression passed with actual local consent/template/preview/insert/undo, pointer recognition and persisted mobile touch. Full-page screenshot capture was replaced with viewport screenshots because temporary viewport changes were closing the responsive assistant while the test interacted with it.
- Live guest scheduling regression passed: actual host forms, public booking persistence, mobile confirmation/ICS, mocked email proof, waiting-room admission, received synthetic audio/video, native tab sharing, chat, reconnection, attendance and removal. Results are recorded in `artifacts/qa/phase11-browser-results.json` and `artifacts/qa/unified-scheduling-browser.log`.

Checks use private fixture databases and mock email/providers. They do not use main user records. Production build output is `artifacts/qa/light-reference-build`; the separately running public booking frontend was not replaced. Existing environment files and the tunnel configuration were not modified.

Local review: http://localhost:3001/dashboard, http://localhost:3001/bookings, http://localhost:3001/meetings.

## Separately authorized Gmail smoke test

The approved future synthetic message was sent once using the existing isolated booking, exact protected message and immutable ICS attachment. A restart-safe restoration path validates the existing message fingerprint, future time, signed invitation, cancelled jobs and single-attempt ledger. Its safeguard suites passed 13 mock tests, including tamper rejection and duplicate prevention.

SMTP authentication passed and Gmail accepted the single message with code 250. The durable attempt is consumed. Automatic retries: zero. Normal scheduling email delivery remains disabled, and the isolated runtime health check confirmed AI, SMS and recording were disabled afterward. Inbox arrival remains unverified and must be confirmed by the recipient. Guest OTP delivery was not enabled or used. No further emails are authorized.

Sanitized result: `artifacts/qa/phase11-approved-gmail-result.json`. The one-shot script refuses another dispatch through the durable existing ledger; it never starts a delivery worker or edits environment files.
