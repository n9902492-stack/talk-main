# Phase 10I - Gemini first-request approval review

PREPARATION ONLY. No Gemini API request is authorized or sent. This packet replaces the older model/prompt packet. Application code, environments, services and billing are unchanged.

Project: `gen-lang-client-0562383032`. Model: `gemini-2.5-flash`. Maximum authorized spending: INR 0. On 2026-10-22 the user-supplied AI Studio and Cloud Console screenshots were directly reviewed: the named key belongs to this project, AI Studio shows Free tier, and Cloud Console shows billing disabled. Linking the complete private local key to the named key relies on the user-reported offline MATCH. No Google API was contacted; actual model access remains untested. See the visual-evidence addendum below; earlier uncertainty notes describe the previous evidence state.

## Complete proposed request (credential redacted)

```http
POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
Content-Type: application/json
Authorization: Bearer <REDACTED_GEMINI_API_KEY>
Content-Length: 2661
```

The following is the complete JSON body formatted for review. The canonical byte-exact UTF-8 body is [phase10i-gemini-first-test.body.json](phase10i-gemini-first-test.body.json). The actual canonical file has no trailing newline. Only whitespace differs from the formatted view.

```json
{
  "max_tokens": 2048,
  "messages": [
    {
      "content": "Return only a bounded semantic diagram in the JSON schema. Never return code, URLs, images, coordinates or tool calls. SWOT sections: 0 strengths,1 weaknesses,2 opportunities,3 threats; Kanban: 0 to do,1 in progress,2 done. Do not assert unprovided business facts. Schema: {\"additionalProperties\":false,\"properties\":{\"edges\":{\"items\":{\"additionalProperties\":false,\"properties\":{\"from\":{\"type\":\"string\"},\"to\":{\"type\":\"string\"},\"type\":{\"enum\":[\"arrow\",\"line\"]}},\"required\":[\"from\",\"to\",\"type\"],\"type\":\"object\"},\"maxItems\":24,\"type\":\"array\"},\"layout\":{\"enum\":[\"horizontal\",\"vertical\",\"grid\",\"flowchart\",\"mindmap\",\"swot\",\"kanban\",\"roadmap\",\"architecture\"]},\"nodes\":{\"items\":{\"additionalProperties\":false,\"properties\":{\"id\":{\"type\":\"string\"},\"section\":{\"maximum\":3,\"minimum\":0,\"type\":\"integer\"},\"text\":{\"maxLength\":160,\"type\":\"string\"},\"type\":{\"enum\":[\"rectangle\",\"rounded\",\"ellipse\",\"text\",\"sticky\"]}},\"required\":[\"id\",\"type\",\"text\"],\"type\":\"object\"},\"maxItems\":24,\"minItems\":1,\"type\":\"array\"},\"schemaVersion\":{\"const\":1},\"title\":{\"maxLength\":160,\"type\":\"string\"}},\"required\":[\"schemaVersion\",\"title\",\"layout\",\"nodes\",\"edges\"],\"type\":\"object\"}",
      "role": "system"
    },
    {
      "content": "{\"notes\":[],\"request\":\"Generate a SWOT analysis for a fictional video meeting application called OrbitMeet. Include strengths, weaknesses, opportunities and threats. Return structured data suitable for editable Konva shapes and sticky notes.\"}",
      "role": "user"
    }
  ],
  "model": "gemini-2.5-flash",
  "response_format": {
    "json_schema": {
      "name": "talk_whiteboard",
      "schema": {
        "additionalProperties": false,
        "properties": {
          "edges": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "type": {
                  "enum": [
                    "arrow",
                    "line"
                  ]
                }
              },
              "required": [
                "from",
                "to",
                "type"
              ],
              "type": "object"
            },
            "maxItems": 24,
            "type": "array"
          },
          "layout": {
            "enum": [
              "horizontal",
              "vertical",
              "grid",
              "flowchart",
              "mindmap",
              "swot",
              "kanban",
              "roadmap",
              "architecture"
            ]
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "id": {
                  "type": "string"
                },
                "section": {
                  "maximum": 3,
                  "minimum": 0,
                  "type": "integer"
                },
                "text": {
                  "maxLength": 160,
                  "type": "string"
                },
                "type": {
                  "enum": [
                    "rectangle",
                    "rounded",
                    "ellipse",
                    "text",
                    "sticky"
                  ]
                }
              },
              "required": [
                "id",
                "type",
                "text"
              ],
              "type": "object"
            },
            "maxItems": 24,
            "minItems": 1,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1
          },
          "title": {
            "maxLength": 160,
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "title",
          "layout",
          "nodes",
          "edges"
        ],
        "type": "object"
      },
      "strict": false
    },
    "type": "json_schema"
  },
  "stream": false
}
```

Body bytes: 2661. SHA-256: `15808093f5c7f539d721ac559b851ae91d41854083a4dd617fb5040e4c6805b9`.

## What would leave the machine

The fictional OrbitMeet request above, the fixed system instructions and JSON schema, and model/output settings. `notes` is empty. No database or saved board is read. No meeting IDs, people, transcripts, recordings, audio/video, board images, session cookies or participant tokens are included. The API key would be used only in the Authorization header; it has not been copied into these files. HTTPS necessarily also exposes normal connection metadata such as the sender IP to Google. The project ID is review metadata and is not a request-body field or billing override.

## Limits and compatibility

- One future inference attempt maximum; zero retries, redirects, fallback models or dialect retries. No health check, discovery or count-token API probes.
- Input admission bound: 8192 using Talk's conservative wire-bytes-plus-256 estimate. This request estimates 2917 by that rule. Rough bytes/4 estimate: 666; neither number is measured Gemini token usage.
- `max_tokens`: 2048. Timeout: 45000 ms. Concurrency: 1. Streaming is disabled. No tools, grounding, file upload, batch processing or explicit cache creation are requested.
- Existing rate limits are 1 per user/hour and 1 per meeting/hour. They are not a lifetime-one-attempt guard. The separate durable guard below now implements the first-test reservation; no attempt has been reserved or sent.
- User-reported project quota: 5 RPM, 250K TPM, 20 RPD. Remaining quota has not been checked. Documented model ceilings (not this request): 1,048,576 input and 65,536 output tokens.
- This is the exact existing OpenAI-compatible builder dialect (`response_format.json_schema`, strict false, `max_tokens`). The REST endpoint and bearer authentication are documented; successful acceptance of this exact schema/dialect is unverified. The provider may reject or ignore unsupported schema keywords. Talk must independently validate output and require proposal review before adding editable canvas objects.
- The existing builder does not set a thinking budget. Gemini may use its default thinking behavior; reasoning can consume the limited output budget and cause truncation. No retry or automatic cap increase is permitted. This preparation does not change the builder.

## Model access, price and data-use restrictions

- Google currently limits Gemini 2.5 models to users who actively used them previously. A newly created key and visible quota do not establish actual access. This test remains pending access/free-tier verification and approval. Keep the requested model; do not automatically substitute another one.
- Eligible Gemini 2.5 Flash standard Free-tier text input/output are listed as free. Expected cost is INR 0 only for an eligible Free-tier key/project within available quota. No application setting or HTTP parameter guarantees a zero provider charge. Do not use a paid key or billing override. No billing settings were changed.
- Unpaid input/output may be used for product improvement and human review. Only this fictional data is permitted.

Official documentation reviewed (public pages only; no Gemini API calls):

- [Compatible REST destination and authentication](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini 2.5 Flash model restrictions and limits](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash)
- [Free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash)
- [Unpaid-service data use](https://ai.google.dev/gemini-api/terms#unpaid-services)

## Existing consent and security

- Root `.env.local` remains Git-ignored. Both WHITEBOARD_CLOUD_AI_ENABLED and WHITEBOARD_CLOUD_AI_OPERATOR_APPROVED remain false. CLOUD_EXTERNAL_RELEASE_APPROVED remains false and blocks the real transport before DNS or sockets.
- Existing application flow checks authenticated whiteboard access and mutation protections. Consent is bound to the account/session, exact payload hash, provider/key configuration fingerprint and board/source versions, expires within five minutes, and must be freshly confirmed. Authorization and source versions are rechecked before sending. This document is not an application consent ticket.
- Existing transport uses HTTPS allowlisting, public-address validation and DNS pinning, rejects redirects, limits response size and does not automatically retry. Durable usage reservations prevent sending the same job twice. Outputs require schema validation and review before canvas application.
- For this first isolated test no existing meeting board is to be read, modified or attached. A future approved result is a proposal only; applying it to a board is separate.

## Offline validation

Created with the existing pure prepare() function using a fake in-memory placeholder rather than the real key. External network egress guard loaded. Assertions checked disabled flags/release lock, exact model/destination/prompt, empty notes, no tools, output cap and body hash. No generate() call, provider connection, service restart or runtime configuration edit occurred.

Await explicit approval for the exact request, plus key/project free-tier and model-access confirmation. Do not send while these conditions are unresolved. If access cannot be confirmed without an API probe, report that uncertainty and obtain separate authorization; no probe is authorized here.

## Durable first-test safeguard (offline safety follow-up)

Implemented in `backend/src/whiteboard-cloud-first-test.mjs`, with the separate Git-ignored ledger `data/whiteboard-cloud-first-test.sqlite`. The ledger is initialized with no attempt reserved. This helper is not mounted as an HTTP route or imported by Talk startup or the public test runtime. Importing it opens no database and makes no network request. The default execution gate remains the existing false source release lock; both environment flags also remain false. No run command is enabled.

After a separate approved release, the first test must execute only through this guard. It requires explicit final approval bound to the fixed project, model, destination, exact body hash and INR 0; it also requires operator confirmation of key/project association, Free tier, remaining quota and no paid fallback. These acknowledgements record evidence requirements and cannot independently certify Google billing. The actual adapter still has its own release lock.

The guard uses a constant test ID independent of key, model or payload. A SQLite BEGIN IMMEDIATE transaction and FULL synchronous COMMIT persist the reservation before calling the provider once. Concurrent processes, later calls, reopened connections and a crash cannot reserve another attempt. The real adapter has no redirect, retry or fallback loop. A model-access denial, rate limit, invalid JSON, connection failure, cancellation or uncertain timeout consumes the attempt. A crash leaves a reserved row that is also consumed; there is no stale-lock expiry or recovery resend. Terminal receipts cannot be reset or deleted through ordinary SQL. Results are not automatically applied to any canvas.

The ledger stores only fixed request identity, an opaque configuration fingerprint, state, timestamps and a sanitized failure code. It stores no raw key, key portion, transcript, prompt or provider response. Protect and retain this ledger: this is a single-laptop guard, not protection against an operator deleting/replacing the entire database, changing its path or modifying source. Do not remove it as cleanup or choose another path for a retry. A future second test needs separate approval and a new explicit policy, not a reset.

Offline tests use fake credentials, mock provider responses and disposable ledgers. They exercise concurrent processes, restart/crash recovery, immutable receipts, changed payload/model rejection and failure consumption. No real credential is used for an inference and no Google destination is contacted.

Local evidence confirms the intended project ID in configuration comments and the prepared review, the Gemini destination/model, key presence, disabled flags and Git protection. This is not authoritative proof of the key's Google project, live billing tier, remaining quota or model eligibility. Model-access restriction remains as recorded from the earlier official documentation check; no Google page or API was requested during this follow-up. Obtain trusted AI Studio/Google Console evidence for key-project and Free-tier status before sending. Successful model/schema access cannot be established by offline checks.

Verification: `npm run test:whiteboard:cloud` passed all 55 tests (18 first-test safeguard tests and 37 existing cloud regression tests), with zero failures and zero skips. Tests used mock inference only, with external egress blocked. `npm run lint` (TypeScript no-emit) also passed. Real Gemini inference, model eligibility and live billing were not tested. No Talk or tunnel service was restarted.

## Visual evidence reconciliation - 2026-10-22 (review only)

The three images attached to the user's review request were directly inspected. No key or key portion, unrelated project detail or billing-account identifier is reproduced here. The AI Studio API Keys image shows the name Talk Whiteboard AI 2, Default Gemini Project, project ID `gen-lang-client-0562383032` and Free tier. The Cloud Console Your projects image shows the same project ID with Billing is disabled. These screenshots resolve the earlier absence of visual evidence for the named key's project association and that project's free/unbilled configuration. They are screenshot evidence, not live API attestations.

The rate-limit image shows Gemini 2.5 Flash with limits 5 RPM, 250K TPM and 20 RPD, and displayed usage 0 against each limit. Its crop does not display a project ID; association with the intended project comes from the user's supplied context. These are displayed limits, not a live quota reservation. The user reports that the complete local key passed MATCH against the key copied from AI Studio; this review does not independently repeat that clipboard comparison or infer a complete secret from a screenshot.

Offline revalidation passed: configured Gemini provider, exact model and HTTPS destination, Git protection, both false environment flags, preserved source release lock, the byte-exact 2661-byte body and the builder's identical regeneration. The separate ledger was opened read-only and has zero attempt rows and both immutability triggers. All 18 single-attempt safeguard tests passed using fake credentials and mocked inference with network egress blocked. No actual inference, key change, environment change, service restart or public-test modification occurred. Only these review documents were reconciled.

Actual acceptance of this key/model/request schema remains UNVERIFIED. The previously reviewed official model notice limits Gemini 2.5 access to prior active users; a visible nonzero quota does not establish inference access. Authentication/API-key restrictions, effective model access, exact schema acceptance, current usable quota, response validity and token usage can only be assessed by a provider response or other separately authorized authoritative evidence. Do not probe them during this review.

Expected cost for the shown unbilled Free-tier configuration is INR 0. No paid model, fallback, billing-project override or automatic upgrade is configured in the prepared request. Visual verification is not an unconditional guarantee about later billing/account changes. This turn authorizes safety review only: keep the attempt unused and normal Cloud AI/release locks disabled. A later approved single-use execution must preserve all these protections; the current source locks were not opened.
