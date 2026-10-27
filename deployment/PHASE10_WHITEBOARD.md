# Phase 10 — collaborative meeting whiteboard

The whiteboard is part of Talk, with the existing account/session system, meeting admission rules and LiveKit connection. No separate account, cloud deployment, paid service or AI provider is used.

## Implementation

- Konva **10.9.0**, MIT license, renders an editor loaded only when opened. React Konva was evaluated but would require matching a newer React peer version; core Konva avoids changing Talk's React runtime. Large packaged editors would introduce additional UI and collaboration architecture. Yjs is useful for character-level concurrent text editing, but object-level server-authoritative operations fit Talk's existing authenticated backend and database adapters.
- Tools: select, pan, pressure-aware pen width, translucent highlighter, object eraser, text, sticky notes, rectangle, rounded rectangle, ellipse, line, arrow and private images. Objects support dragging, transforms, colors, fills, border width, text size, duplication and deletion. Text wraps consistently in the canvas and exports. Double-click text or a note to edit it.
- World coordinates are independent of screen size. Mouse-wheel zoom, fit, reset, pan, shift-click multi-selection, toolbar undo/redo and keyboard shortcuts are supported. Ctrl/Command+C/V uses an in-memory **whiteboard-only** clipboard. Ctrl/Command+D duplicates, Delete removes, Ctrl/Command+Z undoes and Shift+Ctrl/Command+Z redoes. Text dialogs retain ordinary text editing shortcuts.
- Meeting video/audio components stay mounted when the editor opens. The board takes the main stage and cameras form a filmstrip on larger displays. Close the board to see the full presentation/video canvas; screen capture itself keeps running. On small displays the video strip is hidden visually, while media remains connected.
- Meeting Details has a Whiteboard tab alongside Recording and Transcript. It does not activate AI Notes or alter recording consent.

## Synchronization and saves

Every durable edit is an authenticated HTTP operation containing a random request ID, a batch of at most 20 object edits and expected object versions. The backend locks the meeting transaction, validates membership and permissions, commits state and an operation log, then sends a LiveKit `talk.whiteboard.v1` **wake-up hint**. The hint contains no board content and grants no authority.

The editor pulls incremental committed operations once per second and after throttled LiveKit hints. A full snapshot is returned on initial load or after a gap exceeding 100 revisions. Pointer samples are rendered locally and a stroke is committed when the pointer is released; entire canvases are not broadcast for every movement. Thus long strokes become visible to others when completed, generally within the next pull. This is object-level collaboration, not per-character collaborative text editing.

Different-object edits merge. A simultaneous change to the same object returns HTTP 409: the losing edit is explicitly **not saved**, and the editor loads the latest board. It does not silently overwrite or rebase another person's work. Duplicate request IDs with the same actor/body return the original committed result. Altered payloads or different actors cannot reuse them.

Undo can reverse only the requesting user's operation, and only while each affected object is unchanged since that operation. Tombstone versions also protect deleted objects. Redo reverses a successful undo under the same rules. Undo stacks are local to the current open editor; reopening preserves saved content, but not that local undo stack. Large owner clear/restore actions use snapshots rather than an unlimited shared undo history.

The UI says Saved only for committed state. Transport failures retain the exact operation ID/body for Retry save. New edits are blocked until retry or explicit discard. Closing warns about an unsaved change. Browser refresh also gets a standard unsaved-work warning. Unsaved content is never placed in localStorage. It cannot survive an involuntary browser/process crash before commit.

Cursor positions use separate authenticated, throttled HTTP updates (maximum four per second with an idle heartbeat). They live only in backend memory, expire after eight seconds and are filtered against current admission/session status. Closing removes the local cursor and cancels polling/listeners/image loads. Cursor presence is process-local; a future multi-instance deployment would need shared ephemeral presence or sticky routing. Durable PostgreSQL edits already use cross-process advisory locks.

## Authorization and limits

- Authenticated, verified Talk sessions only. Every request checks the existing meeting membership. Mutation transactions recheck session revocation/expiry after acquiring their lock.
- Waiting, denied and removed users cannot read, mutate, download images or export. An unrelated meeting account cannot access the board. Expired/revoked sessions lose access.
- Admitted users start view-only. The owner enables default editing or grants/revokes individual permissions. Co-hosts may grant participant editing, but cannot clear, restore, delete, lock or change owner defaults. The owner can continue editing while the board is locked.
- After a meeting ends, only the owner and authorized co-hosts can reopen the board. Existing ordinary participants lose access.
- Origin, JSON content type, session CSRF tokens, read/edit/upload/export rate limits, strict element schemas and bounded coordinates are enforced on the backend. Untrusted strings are drawn as text and escaped in exports.
- Uploads: still PNG/JPEG/WebP, at most 2 MB and 10 megapixels; decoded and normalized using the existing Sharp image validator, stripped of metadata and resized to at most 1600 pixels, maximum normalized size 1 MB. No remote image references or SVG uploads. Maximum 20 images per board. Images are stored privately in the existing database architecture.
- Maximum 1,200 objects, 2,048 points per stroke, 4,000 characters per text object, 3 MiB canvas state, 32 MiB operation history and 20,000 durable revisions. Exceeding a limit rejects the whole transaction. Export before continuing with another meeting.
- Private PNG/SVG/PDF exports revalidate authorization after rendering, use no-store responses and include only this board's saved revision. Image references are embedded as normalized PNG for consistent raster/PDF support (at most 1024 pixels, with 480-pixel fallback for large PNG payloads). Exported canvas dimensions are capped at 4096 pixels. One export runs per backend process, including cleanup. PDF uses the existing owned-browser cleanup utility; Chromium must be available (Docker's existing `CHROMIUM_PATH` is supported).

## Database changes

Additive migrations: SQLite `backend/src/migrations/009_whiteboards.sql`; PostgreSQL `backend/src/postgres-migrations/007_whiteboards.sql`.

| Table | Purpose |
| --- | --- |
| `talk_whiteboards` | Meeting ownership reference, private canvas, current revision, policy and retention |
| `talk_whiteboard_permissions` | Explicit per-account editing overrides |
| `talk_whiteboard_operations` | Idempotent revision log, before/after values and actor |
| `talk_whiteboard_versions` | Last object revision, including deleted-object tombstones |
| `talk_whiteboard_snapshots` | Recovery snapshots every 25 changes |
| `talk_whiteboard_images` | Validated private image bytes and dimensions |
| `talk_whiteboard_events` | Content-free audit metadata |

Snapshots retain approximately the latest 250 revisions; operations remain until expiry within the history quota. Default retention is 30 days from creation (service supports 1–90 days). An hourly bounded cleanup and access-time cleanup remove expired private state, images, operations and snapshots. Minimal audit metadata remains. Owner deletion removes content immediately and leaves a deleted marker; it cannot be reopened. Existing meeting, recording, transcript and AI tables are preserved. The SQLite-to-PostgreSQL importer includes the new tables in dependency order.

No main or production database was deliberately migrated for Phase 10 validation. Disposable test databases and the separate local whiteboard database receive the additive migration. Back up the main database before a later approved rollout. Do not run migrations or a release against the public test simply to try this editor.

## API

All routes are under `/api/auth/meetings/:meetingId/whiteboard` and require the existing confirmed meeting session.

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | empty, optional `?since=revision` | Authorized snapshot/deltas, policy, collaborators and CSRF token |
| POST | `/open` | Host/co-host creates or opens the meeting's board |
| POST | `/operations` | Validated, versioned object batch or own-undo |
| POST | `/manage` | Owner/moderator policy, clear, restore or deletion |
| POST | `/cursor` | Ephemeral presence, never a durable edit |
| GET | `/snapshots` | Host/co-host recovery index |
| POST | `/images` | Authenticated validated image upload |
| GET | `/images/:imageId` | Meeting-authorized private image |
| GET | `/export/png`, `/export/svg`, `/export/pdf` | Authorized saved-revision export |

Frontend: `Whiteboard.tsx`, `WhiteboardCanvas.tsx`, `useWhiteboard.ts`, `lib/whiteboard.ts`, shared `whiteboardModel.js` and `styles/whiteboard.css`. Existing `LiveMeeting.tsx` and `MeetingHistory.tsx` provide lazy entry points. Backend: `whiteboards.mjs`, `whiteboard-routes.mjs`, `whiteboard-exports.mjs` wired through `auth.mjs`.

## Local testing

1. `npm run meeting:server` — reuses the private loopback LiveKit server on port 7880.
2. `npm run build:whiteboard` — writes **only** `artifacts/qa/phase10-build`, preserving the currently published frontend build.
3. `npm run whiteboard:local` — serves **http://localhost:3001/sign-in**, loopback only, with `data/whiteboard-local/talk.sqlite`. Existing `.env.local` email/Google settings are read privately; local LiveKit credentials are read from ignored `data/livekit-local.json`. The tunnel environment is neither read nor changed. If port 3001 is occupied, startup refuses to stop that service.
4. Sign in using three separate browser profiles/contexts. This isolated database starts empty: create normal accounts with individually chosen passwords and Email OTP, or use Google Sign-In if `http://localhost:3001` is already authorized. No shared passwords or test authentication bypass is added to this runtime.
5. A creates a meeting, B and C use its link and pass the existing waiting room. A opens Whiteboard, then enables participant editing in its settings.
6. A draws a rectangle, B adds a sticky note, C draws an arrow. Refresh/rejoin C and reopen Whiteboard. Switch back to video/presentation and reopen the board; saved content remains.
7. End the meeting and use Meetings → meeting details → Whiteboard. Export PNG/PDF/SVG. Only owner/co-host access remains after meeting end.
8. Create a second meeting and verify its separate board. Test host lock, view-only permissions, removal and cross-meeting denial.

Stop the local whiteboard process with Ctrl+C. Do not stop the separate Cloudflare process. This phase does not start, stop or republish that tunnel; the tunnel adapter explicitly disables whiteboards and its API allowlist excludes them.

## Validation commands and scope

`npm run test:whiteboard`, `npm run test:whiteboard:postgres` (disposable cached PostgreSQL Docker container), `npm run test:whiteboard:browser`, `npm run test:whiteboard:tools`, `npm run lint`, `npm run build:whiteboard`. Existing auth, meeting, recording, Phase 9 foundation and tunnel regression suites are run separately. The repository's lint command is TypeScript; it has no configured ESLint installation, so TypeScript success must not be described as an ESLint pass.

Automated browser checks use three real Chrome processes and the real **local LiveKit SFU** with camera/microphone fixtures and a synthetic identity verifier. They are not tests on physical phones, styluses, separate Wi-Fi networks, Safari or remote team devices. Native browser tab capture is used for screen sharing. No SMS, real AI generation, cloud deployment, production database or public whiteboard is involved.

Final measured results are recorded in `artifacts/qa/phase10-whiteboard-browser.json`, `phase10-regression.log` and `phase10-whiteboard-server.log`. Screenshots and private synthetic export artifacts are in `artifacts/qa/` for local inspection. Do not publish real meeting exports with frontend assets.

Deferred: character-level CRDT text editing, external clipboard/import formats, multiple pages/boards per meeting, persistent personal undo across editor sessions, multi-server ephemeral cursor infrastructure and physical remote-device validation. Scheduling, webinars and further AI phases are not started.

## Validated milestones and results (21 October 2026)

| Milestone | Result |
| --- | --- |
| 10A — inspection/library/architecture | Konva 10.9.0 MIT; server-authoritative operations; existing adapters reused |
| 10B — canvas and tools | Browser drawing, text, sticky notes, images, drag, resize, erase, zoom/pan and personal undo/redo verified |
| 10C — collaboration | Three real Chrome processes share one board; distinct concurrent changes converge; local LiveKit RTP continues |
| 10D — authorization and persistence | SQLite/real PostgreSQL checks, admission/removal, locks, conflicts, idempotency, snapshots, retention and restart recovery pass |
| 10E — meeting integration | Opening/closing preserves mounted media; native tab capture and chat work; reconnection retains the editor |
| 10F — saved boards and exports | Meeting Details reopens the ended meeting board; private SVG/PNG/PDF exports work; uploaded-image pixels verified in PNG/PDF; searchable PDF text and rendered previews inspected |
| 10G — regression/security/performance | Results below; no deployment or public tunnel changes |

Final automated results (suites overlap; do not add all counts):

- Main auth/meetings/recordings/Phase 9/tunnel/whiteboard regression run: **209 passed, 0 failed, 0 skipped**.
- Whiteboard API/model/SQLite suite after export fixes: **11 passed, 0 failed, 0 skipped**, including 1,200-object and history quotas.
- Whiteboard plus explicit public-tunnel isolation checks: **21 passed, 0 failed, 0 skipped**.
- Real disposable PostgreSQL 16 auth/recording/AI-foundation/whiteboard integration: **28 passed, 0 failed, 0 skipped**. Its test container was removed; existing databases were not used.
- Frontend model regression: **47 passed, 0 failed, 0 skipped**.
- Deployment/configuration regression: **14 passed, 0 failed, 0 skipped**.
- Three-browser integration script: **PASS**, including separate simultaneous LiveKit rooms, chat, native tab screen capture, remote decoded presentation width 720 pixels, save retry, refresh and meeting-end history.
- Focused browser script: **PASS**, including real resize handles, image aspect-ratio preservation, contained video captions and emulated mobile touch drawing.
- TypeScript / existing `npm run lint`: **PASS**. Production build in the isolated output folder: **PASS**. **ESLint not run** because this repository has no ESLint package/configuration; it is not counted as passed.
- Local runtime preflight: sign-in HTTP 200; unauthenticated board/export HTTP 401; administrative route HTTP 404; frontend build scan found none of the checked backend secrets.

Measured three-browser run: 18 completed save samples; median HTTP save response **108.9 ms**, maximum **171.6 ms**. Test-backend peak sampled RSS **140 MB**, backend CPU **47.5 seconds** across a **198-second** integration run. These figures include the test backend and are not total laptop memory, GPU usage, production capacity or measured cross-network propagation latency. Decoded remote video increased from 221 to 484 frames and audio packets from 1,182 to 2,516 while using the board. No comparative meeting-frame-rate benchmark or physical device certification is claimed.

The lazy editor chunk is approximately **221 kB / 69 kB gzip**; it is not loaded until a whiteboard is opened. PNG/PDF image rendering originally exposed a platform-specific embedded-WebP issue; exports now embed bounded PNG images and pixel-level regression checks cover it.

Physical phones/tablets/styluses, Safari/Edge-specific runs and real remote Wi-Fi devices remain manual validation. Automated mobile viewport/touch emulation is not physical-device testing. Large boards and concurrent editing are bounded by the documented quotas; this phase does not claim unlimited Miro-scale capacity.

For the current session the loopback test server is running at **http://localhost:3001/sign-in**, using only `data/whiteboard-local/talk.sqlite`. Its PID/launch metadata are in ignored `data/whiteboard-local/server.json`; output is in the adjacent private log. Start/stop instructions above apply when running the script in your own terminal. Main development data, the five-email test file and the public frontend build remain unchanged. The tunnel file retained its 19 October modification time; the public frontend index retained its 21 October 10:32 build.

Source checkpoint: `artifacts/qa/phase10-source-checkpoint.zip` contains the selected implementation files only, with no environment files, account database, uploads or credentials. This is a code checkpoint, not a backup of user data.
