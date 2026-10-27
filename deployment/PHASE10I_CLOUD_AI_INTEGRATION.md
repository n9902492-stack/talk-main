# Phase 10I — Secure cloud LLM integration

Implementation date: 21 October 2026. **Architecture and offline testing only. No external AI inference is authorized or enabled.**

## 1. Architecture and checkpoint

The existing Phase 10H assistant, durable proposal queue, source citations, deterministic diagram layout, review/export UI and native whiteboard operation/undo path are reused. No second canvas, meeting assistant or authentication system was added.

`runtime-auth → cloud provider → cloud consent service → existing whiteboard AI jobs → validated proposal → explicit native apply → existing collaboration`.

The source checkpoint is `artifacts/qa/phase10i-checkpoint/manifest.json`. It excludes credentials, databases and uploads. A private database checkpoint, when refreshing the idle loopback app, belongs under ignored `data/whiteboard-local/`; never publish it. All migrations in tests use disposable databases. No production database is migrated by this task.

## 2. Provider adapters

`backend/src/whiteboard-cloud-provider.mjs` supports:

- `openai-compatible`: explicitly configured Chat Completions HTTPS endpoint, `json_schema` or legacy `json_object`, explicit `max_tokens` or `max_completion_tokens` dialect. There is no automatic format/model retry or provider fallback.
- `openai`: fixed `https://api.openai.com/v1`, Chat Completions, completion-token cap, strict schema with required/nullable fields. This is a contract implementation, **not verified genuine OpenAI inference**.
- The existing separately pinned, loopback-only Ollama adapter remains unchanged and is not enabled by cloud configuration.

The common interface describes provider/model/configuration status, prepares canonical structured requests and estimates, supports bounded/cancellable generation, and returns validated JSON plus available numeric token usage. A missing or invalid optional configuration disables cloud AI without crashing Talk. No paid health check or pricing lookup exists.

API format references: [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat). Other compatible providers must be checked against their own documented dialect before approval.

## 3. Backend configuration

Placeholders were appended only to `.env.example` and `deployment/backend.env.example`. Existing private environment files were not edited. Configuration is server-operator only; no HTTP endpoint can set a provider URL, model, credentials, prices or enablement flags.

| Variable prefix `WHITEBOARD_CLOUD_AI_` | Default / meaning |
|---|---|
| `ENABLED`, `OPERATOR_APPROVED` | `false`; both required, neither sufficient to release external requests |
| `PROVIDER` | `none`; `openai-compatible` or `openai` later |
| `MODEL`, `BASE_URL`, `API_KEY` | blank; backend only, no model default or key generated |
| `ALLOWED_BASE_URLS` | blank; comma-separated exact canonical HTTPS base URLs, without trailing slash |
| `RESPONSE_FORMAT` | `json_schema`; explicitly choose `json_object` only if required by the approved provider |
| `TOKEN_FIELD` | `max_tokens` for generic; OpenAI adapter uses `max_completion_tokens` |
| `MAX_INPUT_TOKENS` | 8192; conservative UTF-8 request-size estimate, allowed 256–32000 |
| `MAX_OUTPUT_TOKENS` | 2048, allowed 64–4096 |
| `REQUEST_TIMEOUT_MS` | 45000, allowed 100–90000 |
| `MAX_REQUESTS_PER_USER` | 5 per rolling hour |
| `MAX_REQUESTS_PER_MEETING` | 10 per rolling hour |
| `MAX_CONCURRENT` | 1 globally, maximum 4 |
| `INPUT_PRICE_PER_MILLION`, `OUTPUT_PRICE_PER_MILLION` | blank; operator-supplied reliable prices, never fetched or invented |
| `PRICE_CURRENCY` | blank; three-letter currency code |
| `ESTIMATED_SPEND_LIMIT` | blank; optional UTC-calendar-month estimated reservation limit in that currency |

Never prefix API keys with `VITE_`, put them in browser storage, commit them or print them. Existing Git ignore conventions protect local private env files. No dependency or AI SDK installation was required.

## 4. Default-disabled release behavior

There are separate operator, per-request and **source-level development release** gates. `CLOUD_EXTERNAL_RELEASE_APPROVED=false` is checked by both the service and the real HTTPS transport, before DNS/socket creation. Credentials alone, an enabled environment flag, a forged browser dialog or `NODE_ENV=test` cannot open the real transport. Only isolated test constructors inject an in-process mock and a test execution gate. There is no environment bypass.

An approval preview may be created locally for a configured but disabled provider. It is marked non-executable at creation; confirming it returns 503 and creates **no inference job**. Turning a gate on later cannot revive that preview. Availability is not probed automatically, and the UI never claims a verified real provider is Available in this phase.

## 5. Consent and privacy

Before any future approved outbound operation, the requester must preview provider, exact destination/model, typed request, operation, source scope/revision/count, data categories, image exclusion, exact outbound JSON, token estimate and charge warning. Confirm and Cancel are distinct actions.

Approval records contain a random proof hash, requester and session binding, canonical payload SHA-256, configuration fingerprint, operation, captured source versions and five-minute expiry. The configuration fingerprint changes with endpoint, model, credentials, limits, format or pricing. Changing the prompt, selection, board revision or destination requires a new preview and confirmation. The browser invalidates a displayed preview on input changes; the backend independently enforces the saved request. Replays return only the same existing job and never create a second provider request.

The worker rechecks authorization, session/admission/edit permissions, gate, expiry, configuration, current source revision/versions, payload hash, claim and cancellation. It checks again immediately before marking the request sent. The consumed approval no longer retains duplicate source text or wire payload; the existing job owns the minimum source snapshot needed for review.

## 6. Information that could leave Talk after separate approval

Only the explicitly typed request, fixed system instructions/JSON schema, model/output settings, and approved text-note contents with opaque object IDs are included. Coordinates and object versions stay inside Talk.

Analysis defaults to **selected text/sticky notes only**; an empty selection is rejected rather than silently using the board. Whole-board text requires an explicit checkbox/scope and remains bounded to 32 nonempty notes and 12 KB of source snapshots. Prompt-to-Canvas sends the typed prompt only. No hidden truncation occurs.

No image pixels/URLs, recordings, transcripts, participant directory/email fields, account identifiers, session cookies, meeting tokens or unrelated board data are collected for the provider. **Text the user types may itself contain names, email addresses or confidential information**; this is not an automatic PII-redaction system. The exact-payload preview is the review boundary. No external content was sent in this task.

## 7. Prompt-to-Canvas

Approved future requests would return the existing bounded semantic diagram schema: title, layout, up to 24 nodes and 24 edges. Existing validation rejects unsupported objects, extra executable fields, invalid IDs/relationships and excessive content. Existing layout creates editable rectangles, rounded rectangles, ellipses, arrows/lines, text and sticky notes. Native object IDs are generated on insertion. Native visual groups/connectors retain Phase 10H limitations; no new incompatible group type was introduced.

Results stay `review_required` until the user explicitly inserts them. Native backend operations enforce authorization, stale-board warnings, replacement confirmation, object-version checks and personal undo/redo. No model response can issue SQL, execute code, assign permissions or invoke arbitrary tools. Offline templates remain labeled templates.

## 8. Summaries, clustering and actions

Create Diagram, Summarize Notes, Organize Brainstorm and Extract Action Items use the existing assistant. Action extraction maps to the existing summarize job rather than adding an incompatible database operation enum. Cloud responses use the existing source-evidence validator. Executive sentences must be literal excerpts of cited notes; every note must occur in exactly one theme. Explicit action/decision evidence is checked conservatively against the source. Owners and deadlines remain unknown when the source does not reliably state them. Manager edits are separately identified as interpretations.

This deliberately preserves Phase 10H's **extractive, conservative contract**, not unrestricted abstractive prose like a general chatbot. Semantic theme proposals are reviewable interpretations, not proven facts. Suggestions are labeled suggestions. Organization never silently rewrites source text. Changed sources block organization; stale proposal insertion requires the existing explicit warning/acknowledgment.

## 9. Usage and cost safeguards

Persisted, content-free reservations enforce user/hour, meeting/hour, global in-flight and optional monthly estimated-spend limits. Cross-meeting PostgreSQL advisory locking makes reservations atomic. Deleting a job or rotating the key does not reset usage. Reservations are retained for 62 days, covering the active UTC billing month; terminal audit rows contain no prompts, raw responses or secrets.

Output caps and request byte limits are hard application bounds. The input estimate uses UTF-8 wire bytes plus a margin; it is intentionally conservative, **not a universal tokenizer or a provider-guaranteed count**. Prices are configured by an operator. Missing prices show Unknown. Configuring a spend limit without usable prices/currency fails closed. All attempts reserve the full configured output allowance, including failures/uncertain outcomes. Usage is recorded when the provider supplies reliable nonnegative integers.

**Application estimates are not guaranteed spending caps. Provider billing, tokenizer differences, hidden/reasoning tokens, rounding, provider processing after cancellation, price changes and other applications sharing a key may cause charges beyond these estimates.** Future approval should use a provider-enforced budget/project limit where available. No paid plan, credits, billing setting or provider subscription was activated here.

## 10. API endpoints

Base: `/api/auth/meetings/:meetingId/whiteboard/ai`.

| Endpoint | Behavior |
|---|---|
| `GET /capabilities` | Existing local capabilities plus sanitized cloud status; no connection probe |
| `POST /cloud/preview` | Local-only disclosure and five-minute request-specific consent record |
| `POST /cloud/confirm` | Revalidate one-time proof/hash/config/sources and atomically queue/reserve; blocked in this release |
| `POST /cloud/cancel` | Cancel pending disclosure and erase captured payload |
| Existing `/jobs`, `/jobs/:id` | Recover progress, sources and reviewable output |
| Existing `/jobs/:id/cancel`, `/review`, `/delete`, `/apply`, `/export/:format` | Reused authorization/review/native apply/private exports |

All writes require the existing confirmed session, admitted meeting/edit permissions, Origin/CSRF/JSON guards and rate limits. Ticket proofs never authorize another account, session or board. There is no public configuration endpoint. The temporary test runtime disables whiteboards and these routes entirely.

## 11. Database and recovery

Additive migrations:

- SQLite `012_whiteboard_cloud.sql`.
- PostgreSQL `010_whiteboard_cloud.sql`.

Existing `talk_whiteboard_ai_jobs` gains `execution_kind`, `cloud_approval_id`, `usage_json`. To avoid destructive rebuilding of the SQLite table's legacy mode CHECK, cloud jobs retain the internal legacy `mode='ollama'` field **only for schema compatibility**. Dispatch is determined by `execution_kind='cloud'`, and API/UI mode is `cloud`; it never routes a cloud job to Ollama.

`talk_whiteboard_ai_approvals` stores exact short-lived consent and binding metadata. `talk_whiteboard_ai_usage` stores content-free durable reservations/status/usage. Existing import and PostgreSQL required-table checks include both. Jobs and consent payloads follow private-board deletion/retention; usage remains bounded for budget integrity. Existing SQLite accounts, sessions and boards are preserved by additive migration.

The existing worker/lease/heartbeat handles jobs. Before sending, a one-way durable `reserved → sent` transition prevents duplicate sends after crashes. A stale `sent` request is never automatically reissued; its result may be uncertain and needs human review. Cloud `/retry` is refused: create a fresh preview and approval for a new attempt. Queued unsent work can recover only while the exact consent remains valid. Timeout/cancellation stops local transport; it cannot promise the provider has not already processed/billed a request.

## 12. Security boundaries

Cloud URLs require an exact operator-configured HTTPS base allowlist, no credentials/query/fragment/unsafe path encoding, port 443, and a hostname. Private, loopback, link-local, metadata, reserved/documentation and unsafe IPv6 addresses are rejected. All resolved A/AAAA addresses are validated immediately before connecting; mixed private/public DNS answers are rejected. TLS keeps the approved hostname/SNI and pins lookup to validated addresses, preventing a second DNS resolution from rebinding the connection. Redirects are rejected, including HTTPS-to-private redirects; proxy environment variables are not consumed.

The real transport is locked before DNS in this phase. Tests exercise DNS/HTTP parsing using injected answers/streams, not live cloud connections. Fixed system instructions and output schemas cannot replace backend authorization. Content is rendered as React text, never executed as HTML. Responses are bounded to 256 KB, output schemas are revalidated and errors are allowlisted/sanitized. No private content or provider errors are logged.

## 13. Verification results

AI tests use **only injected in-process mocks** with external fetch/HTTP/DNS/socket egress blocked. Browser tests block nonlocal browser requests, omit external STUN servers, and use synthetic identities/media. A successful mock is not genuine cloud inference or a provider quality benchmark.

| Check | Final result |
|---|---|
| Cloud provider/consent/security/jobs, external egress blocked | **37 passed, 0 failed, 0 skipped** |
| Existing backend/auth/meetings/recording/Phase 9/whiteboard/config regressions | **271 distinct checks passed after reruns; 2 intentionally skipped** (see run details below) |
| Disposable real PostgreSQL 16, all production-auth/recording/Phase 9/whiteboard suites, with egress guard | **31 passed, 0 failed, 0 skipped** |
| Existing frontend model/effects/reactions/links/password helpers | **47 passed, 0 failed, 0 skipped** |
| Two real Chrome browsers, cloud privacy UI and injected mock | **PASS**, runner exit 0 |
| Existing three real Chrome browser collaboration/media regression | **PASS**, runner exit 0 |
| TypeScript, `npm run lint` | **PASS**; ESLint is not configured |
| Production-mode isolated frontend build | **PASS**; public `frontend/dist` untouched |
| Protected file hashes and private-backend-value bundle scan | **PASS** |
| Refreshed existing loopback SFU, separate fixture browser camera/microphone join | **PASS**; local credentials/config unchanged |

Run details: the baseline had 37 passes and two intentional skips. The first broad run encountered one existing recording-fixture HTTP connection reset during account setup; its isolated rerun passed all 21 recording checks. The expanded 273-check run then passed 268, failed three Firebase build checks because esbuild's parent-directory read was denied by the sandbox, and skipped two. All eight Firebase-hosting checks passed when rerun with the required filesystem access: the three previously failing checks are resolved, producing 271 distinct regression passes and two skips. These overlapping runs are **not additive totals**. The two skipped checks are genuine local-LLM inference quality and genuine handwriting-text recognition; neither is configured/approved here.

Browser tests initially identified stale local-SFU media connectivity, a native-object-count assertion that omitted separately editable text, and an idle fixture HTTP connection reset. Browser tests now use a new short-lived loopback SFU and bounded retry of an idempotent fixture GET with a longer test-server keep-alive; the application meeting transport was not modified. The object-count assertion was corrected. Fixture-error logging withholds raw request details/cookies. A PostgreSQL runner preload initially needed Windows `file:` URL normalization; the final full 31-check run passed with the guard loaded.

The two-browser mock check exercises disabled Confirm, exact payload review, input-change invalidation, Cancel, explicit mock confirmation, queued progress, review-only preview, native insertion, remote synchronization, personal undo and mobile width. The three-browser regression additionally verifies source analysis/review, private TXT/PDF exports, note organization, geometry/undo, refresh, chat, real browser tab sharing and two simultaneous isolated rooms. Local inbound decoded video frames increased **47 → 823**, audio packets **477 → 5,265**. Elapsed test time **133 seconds**, test-backend sampled peak RSS **140 MB**, backend CPU **36.578 seconds**. These are synthetic-media local-SFU measurements, not cloud inference performance, total laptop RAM or remote-Wi-Fi validation.

The lazy assistant bundle is approximately **25.5 kB / 8.3 kB gzip**. No AI model or cloud SDK initializes on meeting join. Real inference latency, quality and billing remain unmeasured.

Evidence under ignored `artifacts/qa/phase10i-*` includes focused security tests, regression tests, disposable PostgreSQL, TypeScript, the isolated production build and desktop/mobile screenshots. No ESLint configuration exists; `npm run lint` is TypeScript checking, not ESLint.

## 14. Limitations

Real provider credentials, connectivity, API acceptance, output quality, actual token billing and cloud latency are deliberately unverified. No AI request can run through the real transport until separate approval and a reviewed release-lock change. Pricing is not fetched automatically. Existing extractive/evidence limits, bounded graph sizes and native connector/group behavior remain. No automatic transcript/image processing, autonomous tasks or Phase 9 activation is added. A durable worker still needs a running backend; no cloud deployment or scale-to-zero worker infrastructure was created.

## 15. Local testing

Use **http://localhost:3001/sign-in** on this laptop. Sign in, open/create a meeting, open Whiteboard → AI Assistant. Offline templates and source rules continue to work. Cloud status should show Not configured or Disabled; no key is required to inspect that state. Select notes before examining future cloud controls. Do not use the public tunnel to test AI.

Useful commands (all local/mock):

```powershell
npm run test:whiteboard:cloud
npm run test:whiteboard:cloud:postgres
npm run build:whiteboard
npm run test:whiteboard:cloud:browser
npm run test:whiteboard:cloud:regression-browser
npm run lint
```

The local build goes to `artifacts/qa/phase10-build`; the public-test `frontend/dist` is not rebuilt. The local app uses `data/whiteboard-local/talk.sqlite`, backed up privately as `data/whiteboard-local/pre-phase10i.sqlite` before migration. The additive SQLite migration was verified there; sign-in returned HTTP 200 and anonymous AI access HTTP 401. After verifying zero participants and both process identities, only the idle loopback Talk app and its idle local SFU were refreshed for a usable local screen. Local SFU credentials/configuration were retained byte-for-byte. Never stop active meetings or the public tunnel for these tests.

## 16. Future real-provider approval

Do not enter a key as implicit consent. First choose the provider, exact HTTPS base URL, model, API dialect, retention/data-use policy, eligible data categories, current documented pricing/currency and a maximum acceptable test charge. Prepare one synthetic non-sensitive prompt and show its exact payload and estimated cost. Obtain explicit user approval for **that concrete first request** before releasing the transport or sending anything.

Then a server operator may configure secrets privately, review the release-lock change, set both operator flags, use fresh per-request consent, and verify one controlled request. Never reuse development-disabled approval records. Review actual provider usage/billing before any further calls. Add provider-specific acceptance/latency/quality results honestly; do not mark Available from a local mock. Approval here does not authorize billing upgrades, deployment, real company content, automatic inference or activating AI in the tunnel runtime.

## 17. Preservation and change inventory

Phase 9 provider/worker source hashes, `.env.tunnel-test.local` and `frontend/dist/index.html` are checked against the checkpoint. Existing private env files, LiveKit Cloud credentials, five-email allowlist, separate tunnel database, public tunnel configuration and process are not edited or restarted. Authentication, meetings, recording, transcription and whiteboard collaboration retain their existing code paths. No external AI requests, paid services, model downloads or deployments occurred.

New implementation files: `backend/src/whiteboard-cloud-provider.mjs`, `backend/src/whiteboard-cloud.mjs`, the two migrations above, `frontend/src/components/WhiteboardCloudConsent.tsx`, this guide. New tests: `tests/helpers/cloud-egress-guard.mjs`, `tests/helpers/cloud-fixture.mjs`, `tests/helpers/local-sfu.mjs`, `tests/whiteboard-cloud-provider.test.mjs`, `tests/whiteboard-cloud-server.test.mjs`, `tests/production-whiteboard-cloud.test.mjs`, `tests/whiteboard-cloud-browser.mjs`, `tests/phase10i-whiteboard-regression-browser.mjs`.

Updated integration files: `backend/src/whiteboard-ai.mjs`, `whiteboard-ai-routes.mjs`, `runtime-auth.mjs`, `postgres-database.mjs`, `import-sqlite.mjs`, `whiteboards.mjs`; `frontend/src/components/WhiteboardAssistant.tsx`, `frontend/src/styles/whiteboard.css`; `.env.example`, `deployment/backend.env.example`, `package.json`, `scripts/test-production-postgres.mjs`, `tests/helpers/live-meeting.mjs`, `tests/whiteboard-intelligence-browser.mjs` (idempotent fixture read retry). Existing SQLite migration-count assertions were advanced from 11 to 12 in `avatars-server`, `email-auth-server`, `firebase-phone-server`, `google-confirmation-server`, `meeting-management`, `transcript-revisions` and `whiteboards-server` tests. A source-checkpoint comparison is retained with the final evidence; unrelated preexisting workspace edits are not part of this phase.
