# Phase 10H — intelligent whiteboard

## 10H-1: architecture and preservation decisions

Source checkpoint: `artifacts/qa/phase10h-checkpoint/manifest.json` plus the listed source copies. Environment files, databases, uploads and recordings are excluded. No deployment or production configuration is changed.

The existing Konva 10.9.0 canvas, native element schema, HTTP revision log, meeting authorization, LiveKit wake-up hints, personal undo and database adapters remain the authority. Generated previews are proposals, never a second collaborative canvas. Application uses one bounded, atomic operation through the same commit/undo system. Ordinary drawing batches keep their existing twenty-object limit; internal validated proposal application and its undo may use up to one hundred changes.

No new layout/model dependency is required. Bounded grids, topological ranks, quadrant/column layouts and mind-map branches are deterministic. Dagre/ELK would add bundle and integration cost without a benefit for the bounded initial diagrams. AI components load only on request.

Two clearly distinguished offline modes are available: editable diagram templates and source-based rule analysis. Neither is advertised as model inference. The separate optional Ollama provider reuses Phase 9's loopback endpoint validation, requires its own explicit enablement/approval and pinned local model, and never changes Phase 9's disabled generation contract. No model is started, pulled or benchmarked during this implementation. OpenAI-compatible/external providers remain future adapters and are not configured.

Only selected text/sticky-note content from a captured board revision can enter analysis. Images, recordings, transcripts and other meetings are excluded. Bounds reject oversized sources instead of silently truncating them. Decisions and action ownership/deadlines must have literal source support; uncertain fields remain unknown. Interpretations stay reviewable suggestions, and approval does not assign real tasks.

Durable proposal jobs and their source versions use an additive SQLite/PostgreSQL table. Cancellation, bounded retries, leases and access revalidation protect asynchronous work. Apply rechecks current board revision, source object versions and editor permissions inside the existing meeting transaction. Replacing selected objects requires explicit confirmation. No replace-entire-board action exists. Retention/deletion removes proposals with their board.

Smart drawing uses bounded local geometry, not an LLM. Conversion is a separate confirmed delete/create operation after saving the pen stroke, so undo restores original ink. Text OCR is a separate capability, initially unconfigured; shape matching will never fabricate words.

No incompatible dependency or irreversible migration is planned. Existing saved element types/fields are preserved; triangles can be represented as closed native line paths. New tables are additive and tested on disposable databases before the isolated localhost database is restarted.

Implementation and measured results are appended as each milestone completes.

## Components and services

- `Whiteboard.tsx` keeps its existing canvas mounted; lazily opens `WhiteboardAssistant.tsx`. `WhiteboardProposalPreview.tsx` shows a read-only SVG proposal using native element data. The existing `useWhiteboard` save/retry/undo path now also accepts a proposal-apply endpoint.
- `whiteboardIntelligence.js` contains bounded semantic schema validation, deterministic layouts, template creation, conservative source analysis, theme organization and report text export. Persistent canvas objects still use `whiteboardModel.js` exclusively.
- `whiteboardGeometry.js` performs browser-local sampling, iterative RDP, line fitting, closure/corner detection, bounding-box edge error, polygon area and ellipse radial error. It has no network dependency or model initialization.
- `whiteboard-ai.mjs` manages authorized private proposal jobs, immutable captured source text/versions, claims, review, application and content-free audit events. `whiteboard-ai-provider.mjs` is an isolated optional Ollama adapter. It shares only loopback endpoint validation with Phase 9.
- `whiteboard-ai-routes.mjs` reuses Talk's confirmed meeting sessions, origin/CSRF checks and bounded request parsing. `whiteboard-ai-exports.mjs` reuses the owned-browser cleanup infrastructure for private, escaped, network-disabled multipage PDF rendering.

## Provider configuration and privacy

**No inference is enabled by this change.** No models, packages or paid APIs were installed. Do not change the tunnel environment. Only after separate approval, adequate free memory and successful model benchmarking, configure the ordinary backend's private local environment with:

```dotenv
WHITEBOARD_AI_ENABLED=false
WHITEBOARD_AI_LOCAL_APPROVED=false
WHITEBOARD_AI_OLLAMA_URL=http://127.0.0.1:11434
# Set an already-approved local model name and its exact installed SHA-256.
# WHITEBOARD_AI_MODEL=approved-model:approved-tag
# WHITEBOARD_AI_MODEL_DIGEST=sha256:...
```

Both flags must explicitly become `true` to permit inference. They are independent of Phase 9 and no active environment file was edited. A literal loopback HTTP endpoint, exact cached-model name/digest, at least 2 GiB available physical RAM, bounded output, 90-second timeout, disabled redirects, structured JSON, no tools, and `keep_alive: 0` are enforced. The adapter never calls pull, downloads, cloud APIs or an external fallback. Only the displayed prompt/text selection is sent after the user checks the disclosure and clicks Generate. Model installation alone is not approval for private-board inference.

Reference: [Ollama structured output documentation](https://docs.ollama.com/capabilities/structured-outputs). Structured output does not replace application validation. External/OpenAI-compatible adapters remain future extension points; they require separate configuration, disclosure and approval before any private data transfer.

## Schema and layout

The transient model response is `{schemaVersion:1,title,layout,nodes,edges}`. Nodes have only safe local IDs, allowlisted native type, text (160 characters) and optional bounded quadrant/column section. Edges reference existing node IDs and choose line/arrow. Unknown fields, model coordinates, permissions, image references, duplicate/unsafe IDs, oversized output, missing edges and cyclic ranked graphs are rejected. Server layout creates validated native elements, then application generates new UUIDs. A provider never chooses persistent canvas IDs.

Supported layouts: horizontal, vertical, grid, ranked flowchart/architecture, two-sided mind map, SWOT quadrants, Kanban columns and roadmap. Layout includes bounded spacing, text-aware height, headings, visual section boundaries and orthogonal connector paths. Up to 24 semantic nodes, 24 edges and 80 generated native objects are allowed. Connectors are editable native paths; they do not yet automatically follow a node after it is moved. Visual section boundaries are not new persistent group objects.

Templates work without a provider and clearly identify placeholder text. They do not infer business strengths, weaknesses, staff status or deadlines from a title. Configured model generation is a separate opt-in mode; its output remains a proposal.

## Summarization, clustering and review

Analysis captures either selected text/sticky objects or all nonempty text/sticky objects at the submitted board revision. Up to 32 notes and 12 KB of captured JSON are accepted. Larger boards must be analyzed in an explicit smaller selection; no hidden truncation, omitted notes or unbounded context is used. Images, audio, video and transcripts are never included.

Offline **source-based rules** use literal excerpts, explicit action/decision markers, conservative English ownership/deadline patterns, some Hindi markers and keyword themes. This is useful extraction, not semantic AI or certified Hindi/Hinglish understanding. Missing fields stay null/“Not specified.” A literal Friday deadline is unresolved, never converted to an invented date.

With an approved provider, the model selects source excerpts and groups every source note exactly once. Executive text must be a literal substring of a cited source; unsupported confirmed decisions/actions, invalid IDs and duplicated theme membership are rejected. Model-generated themes and recommended next steps are suggestions. This conservative extractive approach deliberately avoids unconstrained abstractive factual claims.

Reports include topic, executive excerpts, discussion points, themes, explicit decisions, proposed actions, blockers, questions and suggested next steps. Each extracted item links to source objects and retains the captured text/version. Reviewers may edit a separately identified manager summary, review notes, proposed action titles, owners, deadlines and review statuses. They can approve the report; this creates no actual task assignment. Draft/generated evidence is never overwritten by these review fields.

Organization previews show theme membership first. Confirmed organization patches only source positions and adds headings; it preserves note IDs, text and ownership history. Any changed source version rejects the organization. Other insertions require acknowledgement of a changed source revision and an exact current-revision check. Replacing a captured selection needs an explicit confirmation and unchanged object versions. No entire-board replacement is offered.

TXT/PDF/clipboard and inserted report text include source revision and evidence references. PDF is private, escaped, network-disabled and multipage, with one bounded export per backend process. Changing sources does not silently regenerate or approve an old report.

## Smart Drawing and handwriting limits

Smart Drawing is opt-in. A completed pen stroke is saved normally, then a heuristic match of at least 0.88 shows a translucent preview and confirmation. Accept commits deletion of the untouched original plus creation of a native replacement in one undoable operation. Reject keeps the ink. Low-confidence strokes are not converted. Match percentage is a geometric score, not a calibrated probability.

Initial shapes: axis-aligned rectangles/squares, circles, ellipses, straight lines, single-stroke shaft-and-two-wing arrows, and triangles represented as closed native line paths. Position, approximate bounds, color and stroke width are preserved. Rotated transformed ink, arbitrary multistroke shapes and curved arrows are not recognized in this version. Input is capped at 2,048 points, resampled to 80; view zoom does not enter world-coordinate geometry.

Handwriting **text** recognition is separate. No reliable recognizer has been installed/configured. The panel truthfully disables that action and never fabricates recognized text. Ordinary typed text remains editable, and original handwriting remains ink. A future genuinely validated on-device OCR/handwriting adapter needs confidence thresholds, confirmation, device/language evaluation and separate model/download/privacy approval. No printed-text OCR package is assumed to provide reliable handwriting recognition.

## API, persistence and security

Base: `/api/auth/meetings/:meetingId/whiteboard/ai`.

| Method | Suffix | Purpose |
|---|---|---|
| GET | `/capabilities` | Truthful provider/OCR status and limits |
| GET | `/jobs` | Private recent proposals |
| POST | `/generate`, `/summarize`, `/cluster` | Explicit-consent, idempotent queued proposal |
| GET | `/jobs/:jobId` | Progress, captured sources, stale warning and result |
| POST | `/jobs/:jobId/cancel`, `/retry`, `/delete` | Authorized bounded lifecycle operations |
| POST | `/jobs/:jobId/review` | Version-checked manager review and approval |
| POST | `/jobs/:jobId/apply` | Atomic existing whiteboard commit/undo path |
| GET | `/jobs/:jobId/export/txt`, `/export/pdf` | Authorized private report exports |

SQLite `011_whiteboard_ai.sql` and PostgreSQL `009_whiteboard_ai.sql` add only `talk_whiteboard_ai_jobs`. It holds request hash/ID, requester/session, source revision/text/versions, selected-object versions, operation/mode/provider/model, bounded results, review, timestamps, lease, retry counters, version and applied revision. Existing schema and saved canvas data remain compatible. Import ordering includes the new table and skips it for older SQLite sources. Board expiry or deletion removes proposals and captured text. Audit metadata contains identifiers/counts, never prompts or private notes.

Worker states: queued, processing, review required, applied, failed, cancelled. The worker serializes jobs per process, uses atomic cross-process claims, a heartbeat, stale-claim recovery, two delivery/inference attempts and at most two user-requested retries. Restart recovery checkpoints the captured input and final validated proposal; interrupted inference restarts from the immutable input, not a partial model stream. There are at most 20 saved jobs per board and 10 generation requests per account per hour. No inference runs inside an HTTP request or browser rendering loop.

All access reuses board authorization: admitted users only, ended meetings host/co-host only, existing editor and lock rules, revoked-session checks, no cross-room access. Readable results follow board visibility; only an authorized requester/host/co-host editor can manage or apply them. Permission is rechecked after inference and PDF rendering. Waiting/removed users cannot read sources or results. Applying and recording its job status share the same meeting transaction, so retry cannot duplicate a diagram. Existing personal undo refuses to overwrite collaborators' intervening edits.

The public test adapter still disables whiteboards and its allowlist excludes these APIs. No Cloudflare tunnel, LiveKit Cloud setting, SMS, recording, transcription, Phase 9 generation, production database or public frontend build is enabled/changed.

## Local testing and validation commands

Use **http://localhost:3001/sign-in** with the isolated `data/whiteboard-local/talk.sqlite` runtime. Create/join a meeting, open Whiteboard, grant editing as needed, and click **Assistant**. Choose an editable template or source-based summary, explicitly approve its input, review, then insert/organize. Test **Smart Drawing** with a single pen outline and confirm conversion; Undo restores the ink. The model and handwriting-to-text controls accurately show their unconfigured state.

- `npm run test:whiteboard:ai`
- `npm run test:whiteboard:ai:postgres` — disposable local PostgreSQL only
- `npm run build:whiteboard` — isolated artifact output; public `frontend/dist` is preserved
- `npm run test:whiteboard:ai:browser` — three real Chrome processes/local SFU, synthetic media and identity, templates/rules only
- Existing auth, whiteboard, recording/transcription, Phase 9 and tunnel regression suites
- `npm run lint` — repository TypeScript check; no ESLint is configured

Physical phones/styluses, separate Wi-Fi networks, Safari and genuine model/OCR quality require subsequent manual/approved validation. Automated mobile viewport checks are not physical-device testing. Measurement and final test results follow below.

## Milestone outcomes and final verification — 21 October 2026

| Milestone | Outcome |
|---|---|
| 10H-1 | Existing architecture reused; source checkpoint and private local database checkpoint created; no incompatible native schema changes |
| 10H-2 | Lazy assistant panel, explicit input disclosure, progress, preview, cancel, retry, recent-job recovery and atomic insertion implemented |
| 10H-3 | Eight offline template types and nine deterministic layout modes generate validated native editable objects; no AI claims for templates |
| 10H-4 | Source-based summaries, themes, organization preview, action/summary review and approval, source navigation, TXT/PDF/clipboard and summary insertion implemented |
| 10H-5 | Local geometry matching and confirmed conversion/undo verified on sampled strokes and real browser pointer events |
| 10H-6 | Truthful unconfigured handwriting-to-text interface; genuine recognition is deferred, with original ink retained |
| 10H-7 | Durable isolated jobs, real PostgreSQL/SQLite, authorization, cancellation/recovery, idempotency and concurrent source protection verified |
| 10H-8 | Tests, security boundaries, mobile viewport, local SFU integration, TypeScript and isolated production build verified as described below |

Final checks (overlapping suites are not additive):

- Full backend/configuration regression: **270 passed, 0 failed, 2 explicitly skipped** out of 272. Covers existing authentication including password recovery, meetings/moderation, recording/transcription processing, Phase 9 foundation, saved boards, tunnel isolation and the new intelligent-board modules.
- Focused final recording/intelligence/tunnel run: **52 passed, 0 failed, 2 skipped**. The initial full run exposed an existing test race: recording failure status was observed before asynchronous file removal finished. Its assertion now waits for file cleanup; recording implementation was not changed. The full suite was rerun successfully afterward.
- Real disposable PostgreSQL 16 integration: **30 passed, 0 failed, 0 skipped** across auth, recording, Phase 9, whiteboard, password reset and intelligent-board proposals. Test container removed; no production database used.
- Existing frontend model/effects/reactions/links/password helpers: **47 passed, 0 failed, 0 skipped**.
- Three real Chrome processes against the local LiveKit SFU: **PASS**. Native template preview/insertion, shared state, undo/redo, source summaries and review, private PDF/TXT export, source-preserving organization, actual pointer-based rectangle conversion and ink-restoring undo, refresh recovery, chat, tab capture, two simultaneous isolated rooms and mobile viewport were exercised. Synthetic camera/audio and test identity verification were used; this is not a physical-device or remote-Wi-Fi validation.
- Genuine LLM inference and genuine handwriting-text recognition are the **two skipped tests**. Provider HTTP/JSON/model-pin/cancellation/resource tests use fixtures and are not genuine model quality tests. No model or OCR result is claimed.
- `npm run lint` (TypeScript): **PASS**. Isolated production build: **PASS**. No ESLint configuration exists, so no ESLint pass is claimed.
- A final optional-provider hardening check also passed: **6 provider tests passed, 2 genuine-inference tests skipped**. Invalid/unapproved runtime settings disable only optional AI instead of preventing normal Talk startup; no external request is made. PDF rendering failures return a bounded, private retry/TXT fallback message.

Measured final three-browser integration: **207 seconds** elapsed; test-backend peak sampled RSS **141 MB**, test-backend CPU **41.891 seconds**. Remote video decoded frames rose from **197 to 1,503**, and inbound audio packets from **1,147 to 8,186** during the test. These are local SFU fixture measurements, not a total laptop-memory measurement, cloud capacity estimate or AI-inference benchmark. The final bounded geometry sample averaged **0.244 ms/stroke** across 500 synthetic outlines, recorded in `artifacts/qa/phase10h-regression.log`; it is a CPU microbenchmark, not physical stylus latency.

The assistant is a separate lazy chunk (approximately **19–20 kB / 6–7 kB gzip**); the existing lazy whiteboard is approximately **229 kB / 71 kB gzip**. No model initializes on meeting join or whiteboard open. Low-memory inference fails before any network/model request, leaving templates, rules and normal drawing available.

Evidence: `artifacts/qa/phase10h-browser.json`, `phase10h-regression.log`, `phase10h-postgres.log`, `phase10h-frontend-models.log`, focused logs and desktop/mobile screenshots. Summary exports contain only synthetic fixture notes. The source checkpoint is ignored by Git; `data/whiteboard-local/pre-phase10h.sqlite` is an ignored private backup of the isolated local database and must never be published.

Local app: **http://localhost:3001/sign-in**. It was restarted only after checking no local meeting participants were active. Only its isolated database received the additive migration. Sign-in/password recovery remain HTTP 200, and anonymous intelligent-board access is HTTP 401. The public tunnel was not started or restarted; `.env.tunnel-test.local` retained its previous modification time, and the public `frontend/dist` build remained untouched.

## Remaining limitations and future improvements

- Real natural-language model generation requires separately approved configuration and successful resource/quality benchmarking; it is not enabled or verified here.
- Handwriting-to-text has no configured recognizer and stays disabled. Multistroke handwriting, arbitrary rotated shapes and handwriting language quality are not implemented.
- Offline summarization/clustering is conservative lexical extraction, not general semantic understanding. Unknown/inexact content requires manager review. Long sources require explicit smaller selections instead of hidden truncation.
- Connectors are editable but not persistently bound to moved nodes. Visual groups do not add new native group objects. Layouts are bounded, not an unlimited graph engine.
- Jobs need the backend/worker process to remain available. A future scale-to-zero deployment requires an available worker/CPU and operational configuration; no deployment was attempted.
- Real remote participants, physical touch/stylus devices and non-Chrome browsers remain manual validation. Genuine local-model generation speed and GPU memory use remain unmeasured.
- Future provider adapters, OCR models, richer layouts, persistent connector binding and broader multilingual extraction are separate work. No recording/AI-meeting-summary phase, external transfer, scheduling, webinar work or paid service was started.
