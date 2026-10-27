# Meeting reactions and avatars

The existing pre-join, LiveKit media, moderation, session cookies, chat and screen-sharing paths remain in place. No hosting or paid infrastructure is added.

## Reactions

Open **Reactions** in the meeting toolbar (also available in **More options**). The shared non-secret catalog in `frontend/src/lib/reactionCatalog.js` contains 24 reactions and five categories. Search uses labels, emoji and keywords. Eight recent choices per Talk account are stored locally, without credentials. The optional floating-animation preference is browser-local; turning it off leaves tile reactions visible.

Requests use the existing authenticated, CSRF-protected moderation endpoint. The backend validates the shared allowlist, admits only authorized meeting members and limits each account to five reactions per ten seconds (with an additional IP limit). LiveKit server data notifications trigger a trusted-state refresh, with polling as a recovery fallback. No client-supplied metadata grants authority. Each reaction lasts six seconds, is associated with the sender's Talk account and appears on that account's connected video tiles. Reduced-motion preferences disable entrance animations. Server-relative expiry avoids device-clock differences. Reactions are transient; old reaction event records are pruned by the existing reconciliation timer.

## Avatars

Open **Dashboard → account menu → Profile settings**, or **meeting toolbar → Settings**. Preview a default, initials, one of 12 presets, or an uploaded image; then choose **Save avatar**. Camera state stays unchanged. Profile saves update React's display profile without rotating the authentication session or disconnecting LiveKit. Trusted meeting snapshots supply avatar descriptors for connected members, refreshed via the same LiveKit notification path.

Original SVG illustrations live in `frontend/public/assets/avatars/`: four Cartoon, four Professional and four gradient-shaded **3D style** presets. They are static illustrations, not tracked 3D models. `LICENSE.txt` dedicates the original artwork under CC0; there are no copied or remote avatar assets. `node scripts/create-avatar-assets.mjs` reproduces the assets.

`account_avatars` stores a bounded selection or normalized image in the existing database. SQLite migration `005_account_avatars.sql` runs locally on startup. Production PostgreSQL migration `003_account_avatars.sql` must be applied with the existing migration command before deploying this version. The existing SQLite-to-Postgres importer includes avatars and accepts older backups without that table. Google provider pictures remain separate, so signing in again does not overwrite the selected avatar.

Uploads: authenticated same-origin POST, CSRF, per-account/IP rate limits, maximum 2 MiB request, JPEG/PNG/WebP only, signature + decoded-format validation, maximum 10 million pixels, still images only. Sharp decodes, auto-orients, crops to at most 512×512 and re-encodes WebP with metadata stripped; stored output is capped at 256 KiB. User SVG/GIF/active content is never served. Uploads are served through `/api/auth/avatars/:accountId/image`, as WebP with `nosniff` and `no-store`, only to the owner or admitted peers in an active common meeting. Waiting, removed and unrelated accounts cannot fetch them. Peers can retain images they already viewed; revoking access cannot erase previously downloaded pixels. No object-storage service is required. Database backups should include this profile data.

## Future extension boundary — preparation only

`AvatarSelection` is the persisted, versioned static descriptor. `Avatar` is the rendering boundary; `AvatarPicker` handles preview/save separately; backend validation/storage is in `backend/src/avatars.mjs`. `AvatarRendererCapabilities` describes whether a future renderer needs animation, camera or microphone access. All current renderers are static and request no devices. Future expression/lip-sync/filter adapters must be separately implemented with explicit consent, track cleanup and backend allowlisting. No tracking SDK, facial data, AI processing or new media permissions are included in this phase.

## Local checks

```sh
npm run test:avatars
npm run test:reactions:ui
npm run test:meetings
npm run test:auth
npm run lint
npm run build
npm run test:reactions:browser
npm run test:meetings:experience
npm run test:meetings:moderation
```

The browser tests require the existing local LiveKit server (`npm run meeting:server`). They launch separate real Chrome processes and exchange real LiveKit media/data; camera/microphone inputs and authenticated identities are fixtures. They do not send email/SMS or call real Google/Firebase sign-in. Avatar/reaction evidence and screenshots are written under ignored `artifacts/qa/`. Production Postgres integration still requires the separately configured test database; a skipped integration test is not a database deployment verification.

Test the app at **http://localhost:3001/dashboard**, use your existing login, then **Start a session**. Invite another verified Talk account via the meeting link. In Settings turn the camera off and change the avatar; in Reactions send/search emoji. The host must admit the second account when approval is enabled.
