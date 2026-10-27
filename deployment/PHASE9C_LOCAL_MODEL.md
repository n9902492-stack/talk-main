# Phase 9C: local Ollama installation and isolated benchmarking

This phase installs only official Windows Ollama and the approved
`qwen3:1.7b-q4_K_M` model. It does not enable Talk AI generation, change the
Phase 9B provider, use private transcripts, apply migrations, or change the
temporary Cloudflare/LiveKit environment.

## Recheck: 2026-10-21

The existing Ollama **0.40.6** installation was reused. No software or model was
downloaded again. Exactly one installed model remains:
`qwen3:1.7b-q4_K_M`, with the same approved manifest digest and Q4_K_M metadata.
The API still listens only on `127.0.0.1:11434`; the user setting and server log
confirm cloud features disabled. CUDA/GTX 1650 discovery is confirmed, and no
model is loaded.

Available physical RAM was initially **0.26 GiB**, then **0.67-0.68 GiB** in the
final samples. Approximate grouped working sets in the final sample were:

| Application | Working set |
| --- | --- |
| Docker/WSL VM | 1,660 MiB |
| Chrome | 1,073 MiB |
| VS Code | 614 MiB |
| Edge | 326 MiB |

Grouped working sets can count shared pages; they are diagnostic indicators,
not additive unique physical-memory totals. Docker has an active unrelated
application stack. No application, container, database or development process
was closed. The Talk test backend and Cloudflare connector were confirmed alive.
The private test configuration was not changed.

The synthetic harness dry-run passed again without requesting inference.
English/Hindi/Hinglish inference, semantic quality, tokens/sec, actual GPU
offload and peak inference CPU/RAM/VRAM remain **postponed**, because the minimum
2 GiB available physical RAM requirement was not met. The earlier 22 offline
tests are historical checks from installation; they were not repeated during
this read-only recheck. Phase 9D has not started.

Close unused browser tabs/windows and extra editor windows after saving work,
while leaving active meetings open. Only stop the unrelated Docker workload
after its owner confirms it is no longer needed. Recheck memory before resuming
the already approved synthetic benchmark; preferably leave 3 GiB available.

Current evidence: `artifacts/qa/phase9c/recheck-20261021.json` and
`artifacts/qa/phase9c/resources-20261021.json`.

## Verified outcome: 2026-10-20

**Installation and the single-model download are complete. Genuine inference
benchmarks are postponed because available physical RAM remains insufficient.**

| Check | Result |
| --- | --- |
| Official Ollama Windows installer | 0.40.6; published SHA-256 matched; valid Ollama Inc. signature |
| Local CLI and server | Both report 0.40.6 |
| API listener | Only `127.0.0.1:11434` |
| Cloud features | Disabled in user environment and confirmed in server startup log |
| Installed model | Exactly one: `qwen3:1.7b-q4_K_M` |
| Model metadata | `qwen3` family; `Q4_K_M`; approved weight-layer hash matched |
| Downloaded model size | 1,359,293,444 bytes including metadata, approximately 1.36 GB |
| GPU discovery | Ollama startup confirms CUDA and GTX 1650 |
| Loaded models after verification | Zero |
| Final available physical RAM | 0.53 GiB; independent benchmark gate reported 0.54 GiB |
| Final C: free disk | 48.84 GiB |
| Offline harness/provider/evidence tests | 22 passed, zero failed or skipped |
| Dry-run and PowerShell syntax validation | Passed |
| Low-memory guard | Correctly refused to launch the benchmark, before child/model requests |
| English/Hindi/Hinglish model quality | Not measured |
| Actual GPU inference, tokens/sec, inference CPU/RAM/VRAM peaks | Not measured |

The installed manifest digest is
`sha256:8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7`.
The model weight layer is
`sha256:3d0b790534fe4b79525fc3692950408dca41171676ed7e21db57af5c65ef6ab6`.
These are public model identifiers, not credentials. Metadata queries do not
prove that a real inference uses GPU offload. No synthetic or private transcript
has been sent for inference, and no model was loaded for this phase.

Evidence is under `artifacts/qa/phase9c/`: `installation.json`,
`model-registry-pin.json`, `verification.json`, `offline-tests.tap`,
`harness-dry-run.json` and `benchmark-readiness.log`. The first CLI pull attempt
was interrupted by PowerShell's treatment of stderr progress; the retry used
Ollama's local pull API and completed successfully with digest verification.

## Installation boundary

The approved official release is Ollama **0.40.6**. Its Windows installer is
downloaded from the official `ollama/ollama` GitHub release and must pass both
the published SHA-256 and a valid Windows Authenticode signature for Ollama Inc.
Installation artifacts and verification evidence are kept under the already
Git-ignored `artifacts/qa/phase9c/` directory.

The native installer uses the current user's installation directory:
`%LOCALAPPDATA%\Programs\Ollama`. The model cache uses Ollama's default
`%USERPROFILE%\.ollama\models` location. No Docker image or additional model is
needed. Ollama's own local identity keys are private; do not print or commit them.

Only these Ollama-specific user environment settings are configured:

| Setting | Value |
| --- | --- |
| `OLLAMA_HOST` | `127.0.0.1:11434` |
| `OLLAMA_NO_CLOUD` | `1` |
| `OLLAMA_MAX_LOADED_MODELS` | `1` |
| `OLLAMA_NUM_PARALLEL` | `1` |
| `OLLAMA_CONTEXT_LENGTH` | `2048` |
| `OLLAMA_KEEP_ALIVE` | `0` |

These do not belong in `.env.tunnel-test.local`. Never proxy or tunnel port
11434. Local Ollama has no application authentication boundary; keep its API
restricted to loopback. Cloud features are disabled before first startup.

## Memory and benchmark gate

The 2026-10-20 resource checks found an AMD Ryzen 5 4600H, 7.42 GiB usable RAM,
and a GTX 1650 with 4 GB VRAM, compute capability 7.5 and NVIDIA driver 566.07.
Only about 0.37-0.52 GiB system RAM was available. Docker/WSL was running an
active, unrelated application stack. Its containers and all other development
services must be left running unless the user separately authorizes stopping
them after checking their dependencies.

The benchmark requires **at least 2 GiB available physical RAM**, preferably
3 GiB, before starting each case. Sufficient disk space and GPU compatibility
do not prove that inference is safe under the current memory pressure.
Close unused browser tabs or applications normally when their work is finished.
Stop an unrelated Docker workload only when its owner confirms it is unused.
Do not force-kill apps, disable security software, change paging settings or
terminate WSL merely to satisfy the gate.

## Standalone synthetic tests

The new files are independent of Talk's runtime and databases:

- `scripts/phase9c-benchmark.mjs`: explicit digest-pinned local inference.
- `scripts/run-phase9c-benchmark.ps1`: optional Windows resource sampler.
- `tests/fixtures/assistant-benchmark/meetings.mjs`: synthetic English, Hindi
  and Hinglish transcripts with reference facts and known/unknown identities.
- `tests/phase9c-benchmark.test.mjs`: fixture, schema and safety checks.

Prepare without contacting Ollama or requesting inference:

```powershell
node --test tests/phase9c-benchmark.test.mjs
node scripts/phase9c-benchmark.mjs --dry-run
```

After installation, sufficient memory, no active meeting, and explicit model
digest verification, the already approved synthetic benchmark can be resumed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-phase9c-benchmark.ps1 -Digest 'sha256:<installed-model-digest>'
```

The wrapper checks memory before launching children; the Node harness repeats
that gate before each inference. The endpoint is fixed to
`http://127.0.0.1:11434`. Only the approved exact tag or its `qwen3:1.7b` alias
can be selected, with the expected installed digest, `qwen3` family and
`Q4_K_M` quantization. Neither script pulls models or signs into a cloud account.

Requests are sequential, use a 4096-token context, cap generated output at
1600 tokens, disable thinking, and request the compact Phase 9B JSON schema.
The small synthetic fixtures have a conservative prompt-budget estimate;
long real transcripts require a separately implemented segment-aware chunker.
Never silently truncate real source text to fit the model.

Each result is validated against Phase 9B's original evidence validator. Checks
cover status updates, completed/pending work, blockers, decisions, assigned
actions, literal deadlines and null identities for unknown speakers/owners.
Reference coverage is not a semantic-accuracy score. A human must inspect
unsupported claims, negation, omissions and whether every conclusion follows
from its quotation. Valid JSON alone does not establish model quality.

## Performance evidence and cleanup

Inference artifacts include wall time, model loading time, prompt/generation
tokens and duration, tokens per second, truncation, evidence validity, reference
coverage and model VRAM residency. The optional sampler records system CPU,
available/used physical RAM, individual Ollama process working/private memory
and NVIDIA VRAM/utilization, with sampled peaks and a baseline.

System measurements include other applications; short peaks may be missed and
CIM adds sampling overhead. GPU residency must be checked during actual model
execution. Hardware compatibility alone is not proof of GPU acceleration.
No performance numbers should be published if inference was postponed.

The harness unloads the approved model between cases and in its normal cleanup.
Forced interruption may require explicitly unloading only that approved model:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" stop qwen3:1.7b-q4_K_M
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" ps
```

## Next boundary

There are no paid API or cloud charges for this local setup; internet bandwidth,
storage and electricity still apply. Installation is not Talk integration.
Phase 9D needs separate instruction and an enabled local HTTP adapter, model
digest exposed at the provider's top level, benchmark-driven job limits,
chunking and semantic-quality safeguards. Keep the existing provider disabled
and the tunnel adapter's `assistant: false` setting intact.
