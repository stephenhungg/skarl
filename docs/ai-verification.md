# AI Verification

The shared Convex dev deployment now has a scheduled Node verification pipeline,
private upload workflow, server-computed original SHA-256, separate visual/audio
observations, deterministic task-scoped comparison and canonical report validation.
The measured live run and remaining limits are recorded below. Tests use mocked
Gemini outputs except the separately identified cloud sample. No training-data
quality benchmark or real human demonstration evaluation has been completed.

## Why these choices

Skarl treats the VLM as a sensor, not a judge. VL-RewardBench (CVPR 2025, [arXiv:2411.17451](https://arxiv.org/abs/2411.17451)) and MLLM-as-a-Judge (ICML 2024, [arXiv:2402.04788](https://arxiv.org/abs/2402.04788)) report that multimodal judges fail mostly at perception and drift on holistic scoring, so Gemini emits only structured, timestamped observations from silent frames, a separate model transcribes audio, and deterministic code applies a decomposed rubric mirroring the wrong-object / wrong-order / missing-step taxonomy of procedural mistake detection (Assembly101, CaptainCook4D, Ego-Exo4D). Every event must cite a sampled frame; the audio and video channels are independent and must agree; a two-model panel (after PoLL, [arXiv:2404.18796](https://arxiv.org/abs/2404.18796)) routes any disagreement to human review; nothing auto-accepts on failure. We report false-acceptance with Wilson 95% intervals and a risk-coverage operating point (selective prediction) instead of bare accuracy. Conformal abstention guarantees and SSCD/VSC-style copy detection are next.

The panel uses two Gemini models, not disjoint model families; agreement is not
proof of correctness or statistical independence. The jury, intervals and trim
alignment are implemented and locally tested, with deployment and a labeled
human corpus run still required. The research motivates the design; it does not
establish Skarl accuracy.

## Implemented pipeline

1. A contributor obtains `submissions.generateUploadUrl`, uploads directly to
   Convex storage, then calls `submissions.create`. The mutation checks persisted
   demo membership, consent, frozen rubric, file metadata/size and an idempotent
   client request ID; it creates the submission/job and schedules `verify.run`.
2. The internal Node action claims one fenced generation, reads the stored Blob
   and recomputes SHA-256 over its bytes. It compares with Convex's server storage
   metadata hash; client claims cannot supply the authoritative source hash.
3. `ffmpeg-static` runs as an external Node dependency. Cloud package files lost
   executable permission (`EACCES` observed); each invocation copies the binary
   into its own private temporary directory, applies mode 0700 and removes it
   with all derived media in `finally`. Concurrent-request tests use distinct
   copies. There is no shell interpolation or network-enabled demuxing.
4. FFmpeg produces an H.264 MP4 with audio actually removed (`-an`) and a separate
   mono 16 kHz PCM WAV. The visual call receives twelve JPEG frames extracted by accurate seeks
   from original clip times, at <=320px and <=100KiB/frame. JPEGs cannot carry
   the audio stream; only the separate WAV goes to speech. No transcript or
   audio observation is supplied to the visual model. Frame times approximate
   the requested point within one source-frame interval, not exact event times.
5. The visual response schema caps events at eight (the local parser separately
   enforces all shape/bounds rules); large constrained-output arrays stalled
   during integration. Native-video requests also returned 503/timeouts, so
   timestamped image input is the implemented visual path. By default, two silent
   visual requests (Argon and Flash) and one separate audio request run concurrently
   through the Interactions API with `store: false`, no tools and one 30-second whole-request
   deadline per stage. The shared transport allows at most three total transient
   attempts; all attempts, response reads and backoff share that same deadline,
   rather than receiving 30 seconds each. Other errors fail immediately with sanitized codes.
6. Visual event intervals must contain at least one actual sampled frame time;
   otherwise the observation is invalid and routes to review. Video returns structured visible action/object/target intervals; it cannot
   return an acceptance recommendation. The default audio model returns
   structured verbatim word annotations. Deterministic English parsing turns
   those into narrated action claims. Zero-duration quantized words are grouped
   with adjacent provider-timed words while preserving transcript text and
   provider interval endpoints; new word timing is not invented.
7. Deterministic code compares the frozen task's pickup, destination placement/order
   and speech/action agreement (two-second alignment tolerance). A structured
   `taskSpec` supplies the object, distractors, target, ordered steps and narration
   expectations. Supported two-step pickup/place criteria must match those steps;
   unknown semantics, ambiguous objects, missing modalities, instruction-like
   narration, duplicate candidates or failures route to review. A contradiction
   may request correction. Model text never sets financial state.
8. `validateVerificationReportForRubric` checks every report against the shared
   JSON Schema, Unicode/timestamp constraints and rubric IDs before the Node
   action stores it. The validator imports the schema statically so it works in
   the bundled action; it no longer reads a local schema file at runtime.
9. The internal completion mutation checks job generation, source/rubric/version,
   report hash and current submission before atomically storing the immutable
   report/projection and moving the submission to review/correction. It creates
   no payable, acceptance decision or payment. A five-minute watchdog handles
   interrupted jobs by exposing review rather than leaving a spinner.

## Task-scoped evidence (source implementation, October 25)

`task-evidence-2.0` uses the frozen rubric's structured vocabulary. Order creation
(`orders:createOrder`, the public HTTP route and MCP) stores the rubric with
`taskSpecStatus: pending` and schedules an internal extraction action. The existing
Gemini provider extracts `{ object, distractors, target, steps, narration }` from
that order's **criteria text**, with no task example or default in the prompt.
Strict response-schema validation and normalization precede storage. The spec is
bound to the original `contentHash`, extraction version, provider/model and an
additional `taskSpecHash`; frozen financial terms and original rubric hashes do
not change. Optional caller-supplied specs remain request bindings for backwards
compatibility, but never become trusted semantics.

There is no implicit legacy task. Missing credentials, unavailable/incomplete
responses, invalid schema, unknown extraction versions or stale hash bindings
leave the task pending. Verification records failed/review-only evidence; a prior
accept projection cannot automatically qualify a pending order. Evidence-bound
owning-buyer review remains available. Rerun backfill after provider recovery.

Both silent visual judges receive the same spec and criterion descriptions in
separate image-only requests. General audio models receive an independently
constructed audio-only prompt. Native Transcribe retains its existing verbatim,
word-timestamp request; deterministic claim extraction uses the frozen spec.
No visual request receives narration or an audio observation. Media text cannot
change labels, tools, payment rules or roles. Prompts require the complete
placement relationship before returning the target label, with `other` for a
clearly wrong relationship and `unknown` for uncertainty.

The live can order `kh7c6cy844fyjxzpsg945v0c618gzsha` requires picking up the can
and placing it **closer to the hat that is next to the lamp**. This is relative
movement toward a landmark, not placing the can on or inside a hat. Its frozen
spec retains that exact step. Timestamped before/after visual evidence must
support the relationship; target-label validation alone does not prove spatial
accuracy. The deterministic comparator currently implements two-step pickup/place
and standard action-aligned narration, including this relative-placement template.
Additional actions or unsupported criterion/narration semantics require review.

Canonical reports can carry `observations.video` / `observations.audio`. Shared
TypeScript and Python shape validation remains available for reading artifacts;
scoped validation additionally takes the trusted order spec and rejects labels
from another task. Historical reports retain generic shape validation and remain readable;
current acceptance with task observations requires the trusted extracted spec. Historical reports
are never rewritten. Liveness still compares the issued random words independently
of task vocabulary. Coach explanations and dataset `language_instruction` already
use report evidence and the frozen rubric respectively.

The detector witness uses exact supported classes, with no can-to-bottle/cup
approximation. A can has no faithful class and returns `not_applicable`, even if
legacy cup detections exist. New derived runs bind task object/class and compute
overlap timestamps from validated uploaded frames. These browser observations
remain advisory and client-computed, never authority for acceptance or payment.
Historical unscoped object summaries remain readable, but cannot corroborate a task;
new detector witnesses require an explicit matching task-object/class binding.

### Operator handoff (no deployment performed by this change)

Deploy the Convex schema/functions and web changes, then run this internal,
idempotent migration against the intended deployment:

```sh
pnpm exec convex run --prod orders:backfillTaskSpecs '{}'
```

It visits existing open orders and extracts from **each order's own rubric**,
without any per-order IDs, rubric hashes or task constants. Valid current-version
extractions are reused. Failures remain pending and may be retried. The action
returns ready/pending/skipped counts; it preserves financial terms, original
rubric hashes and historical reports. It does not rerun old submissions, create
a payable or perform a chain transaction. New submissions are needed to obtain
new verifier evidence. `taskSpecMigration:backfill` is a compatibility action for
the same generic backfill. See [runtime configuration](config.md) for environment
keys, defaults and exact operator commands.

Synthetic tests cover can/hat acceptance against its spec, cross-task rejection,
legacy report compatibility, task prompts, injection resistance, both visual jury
members and unavailable-spec persistence. These are not live Gemini accuracy.
A live can clip, physical-phone capture and deployed behavior remain unverified.
For private, verification-only evaluation, set manifest `criterionIds` to
`["can-pickup", "hat-placement", "narration-alignment"]`, then run:

```sh
pnpm eval:clips /private/manifest.json --order-id kh7c6cy844fyjxzpsg945v0c618gzsha
```

## Historical Task 3 smoke test (3.8 Flash)

The earlier evaluation runner processed one pre-labeled generated color-pattern clip
with machine speech, using isolated copy scope and verification-only licensing.
Both independent stages completed: `gemini-3.8-flash` visual observation took
**3,629 ms** and `gemini-3.5-transcribe` took **1,038 ms**. Backend processing was
**9,766 ms**; client create-to-stored-report latency was **12,443 ms**. All three
criteria were unobservable and both advisory and operational reports recommended
review. This proves the transport/report path on a generated negative; it does
not prove task acceptance, human-task accuracy or calibrated copy detection.
The earlier provider failures below remain relevant operational observations.

Scoped evaluation adds a canonical advisory quality report before the licensing
warning. Its hash/source/rubric are bound to the operational report, which stays
review-only. Full schema validation runs in the Node action; Convex's standard
runtime forbids Ajv's dynamic compilation, so its completion mutation checks
scope, hashes, frozen criterion IDs and the exact licensing guard. See the
[clip runner](../evals/README.md#run-actual-local-clips) and [status](status.md).

## Real YouTube-origin negative smoke test

The deployed verifier also processed the real 19-second [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) recording by Jawed Karim and Yakov Lapitsky, retrieved unmodified from its [CC BY 3.0 Wikimedia copy](https://commons.wikimedia.org/wiki/File:Me_at_the_zoo.webm). Flash visual inference completed in **4,893 ms**, Transcribe in **1,322 ms**, and backend processing in **11,622 ms**. The stored report recommended `needs_review` with all three red-cup criteria unobservable. Both modalities ran successfully; the unrelated content cannot qualify as red-cup evidence. The upload was verification-only, with no acceptance or payment requested. See [source, submission ID and full timing definitions](status.md#real-youtube-origin-clip-verification--october-25-2026). This is a live transport/report check, not an accuracy benchmark.

## Task 2 cloud run and initial provider limits

The earlier Task 2 ten-second synthetic clip completed the cloud action in **8,942 ms**.
Its real `gemini-3.5-transcribe` audio round trip was **1,262 ms** and the transcript
was stored. Server hashing, actual FFmpeg processing and canonical failure-report
persistence ran. The visual stage returned HTTP 503; the final report is failed /
needs_review. Earlier native-video attempts and a minimal image probe also failed
or timed out. A listed Argon model returned 429 with zero free-tier quota. These
are historical errors; billing is now enabled and the latest probes below
succeeded. **That Task 2 attempt did not produce a successful visual observation.** The
later Task 3 generated-input success is above; human-demo quality remains unmeasured.
See [current status](status.md#task-2-verification-and-actual-provider-state).

## Models and configuration

Set these **on the Convex deployment**, never in browser code:

```dotenv
VERIFIER_JURY=on
GEMINI_VIDEO_MODEL=gemini-4-argon
GEMINI_AUDIO_MODEL=gemini-3.5-transcribe
GEMINI_FINANCE_MODEL=gemini-3.8-flash
```

`GEMINI_API_KEY` is configured only as a Convex secret. No key belongs in Git,
reports, logs or the sample script. `VERIFIER_JURY` defaults to `on`; only
`off` disables it. With the jury enabled and no explicit `evalVideoModel`, both
`gemini-4-argon` and `gemini-3.8-flash` inspect the same silent frames through
`Promise.allSettled`, with Argon as the primary observation. `GEMINI_VIDEO_MODEL`
selects the single visual model when the jury is off. An explicit evaluation model
always retains the single-model path. Audio and finance model IDs remain
configurable through their environment variables. Historical
3.8 runs above and in [finance measurements](finance-agent.md#historical-live-read-only-loop-measurement)
retain their original model IDs and measured times.
If `GEMINI_AUDIO_MODEL` names a general Gemini model, the adapter requests strict
JSON transcript/segments/claims and checks claims against the actual transcript.
The Transcribe adapter uses its native structured `word_info` annotations,
verbatim mode and word timestamps; it does not ask that ASR model to make a
semantic acceptance decision. Rubric comparison remains deterministic; no model
call performs final comparison or grants payment authority.

The action builds a report for each visual model against the same audio and
rubric. Different criterion statuses, or either visual call failing, add
`Visual judges disagree: <criteria>` and force review. Both visual runs are
recorded in `pipeline.modelRuns` (the canonical cap remains 16).
`observations.jury` stores advisory per-model reports, disagreed criterion IDs
and an `agreementFraction`: agreeing criteria divided by all rubric criteria.
Failed visual or audio analysis records `null`, never fallback agreement. A
visual failure also marks the final pipeline failed; successful disagreement
marks it `needs_review`. No failed secondary model is silently replaced.

Billing is now enabled. The team's latest Interactions API probes all returned
HTTP 200 with correct visual responses: 3.8 Flash in approximately **2.1 seconds**,
4 Argon in **3.0 seconds**, and 3.6 Flash in **1.4 seconds**. The current video
default is 4 Argon; finance and read-only `askAgent` retain 3.8 Flash for
interactive latency. Model IDs remain configurable; no automatic fallback is
configured. These are provider availability/latency probes, not a
Skarl human-task benchmark or a guarantee of future availability.

The earlier free-tier 3.8/3.7 stalls, Flash 503 responses and Argon zero-quota
responses are historical and are not current blockers after these successful
billing-enabled probes. Historical measurements above retain their original
results. New provider failures and timeouts still remain distinct from validation
failures and cannot become successful reports. A valid JSON schema does not prove an observation is true or its
timestamps are accurate. The finance agent uses the same transport: at most 30
seconds per provider round, including retries, within its two-minute overall budget.

## Video model decision

The team’s subsequent A/B probe used real sampled frames. Both `gemini-4-argon`
and `gemini-3.8-flash` returned zero hallucinated events in that probe. Argon
reported visibility `clear` where Flash returned `uncertain`; the latter can
force otherwise valid clips into review. Argon took approximately **4.4–5.0 s**,
compared with **3.1–4.1 s** for Flash. The video default therefore changes to
Argon, while finance and read-only `askAgent` keep Flash for interactive latency.
These are team-reported directional observations, not a measured accuracy or
false-acceptance result on a labeled corpus. Historical Flash runs above retain
their original model IDs and timings.

Use the [mini-evaluation runner](../evals/README.md#run-actual-local-clips) to
compare both models on the same frozen clip bytes and expected labels. Keep
model-specific duplicate scopes and report coverage, decision accuracy,
false accepts, review rate and latency separately for each model. Evaluation
overrides must never change the deployment-wide model or make an evaluation
submission payable.

## Copy detection and provenance

The original SHA-256 is computed server-side. Six grayscale 9×8 frames are sampled
at relative positions `(i + 0.5) / 6`, for `i = 0..5`. Horizontal dHash yields 16
lowercase hex characters per frame; the ordered fingerprint concatenates all six.
Compare frame sequences with a monotonic best alignment that permits skipped
frames and unequal sequence lengths. Each match advances both indices: a frame
cannot be reused to manufacture three matches. Select the largest qualifying
match count, then the lowest total Hamming distance, with at least three matched
informative frames, mean <=6 bits/frame and no matched distance >10 bits.
Uniform all-zero/all-one hashes are not informative; each input must contain
at least two distinct informative hashes to reject patterned-static clips.
These heuristic thresholds are not calibrated against real task retakes.

Both analysis and `acceptAndPublish` check copy candidates. The finance mutation
rechecks accepted work in the same transaction and organization, so a concurrent
second copy cannot create another payable. Exact hash and legacy exact
fingerprint checks remain; approximate frame matches can also block with a
matching submission audit reference. The bounded demo corpus cap is 200 records;
exceeding it routes analysis to review or blocks acceptance rather than silently
skipping copy checks. No vector service is needed.

The chosen live path is **serverComputed** dHashes. The recorder may also provide
`clientFrameDHashes: [{timestampMs, hash}]`, with 3–12 strictly increasing safe
integer timestamps within 30 seconds and 16 lowercase hex characters per hash.
If server media preparation fails, these may be retained as **clientReported**
fallback evidence, explicitly warned and never sufficient for automatic
acceptance. They are not proof of bytes, authenticity or uniqueness. The decoded
original stays quarantined on such a failure.

An aligned sample match is a candidate, not a fraud verdict or a proven continuous
overlap interval. The evidence query returns the actual left/right sample indices,
times and stored frame assets used by the matcher. Local FFmpeg re-encode and
synthetic one-second-shift regressions pass; they do not measure real-world trim
recall. dHash does not cover crop, flip, overlay or screen recapture. Speed edits,
static-scene ambiguity and hard-negative independent retakes remain uncalibrated.
Payment/review decisions remain separate.

## Client and sample contract

- `submissions.generateUploadUrl({demoIdentity:"contributor"})` returns the native
  upload URL. POST binary video with its correct MIME type, then use `storageId`.
- `submissions.create({demoIdentity,orderId,storageId,clientRequestId,
  consentAcknowledged:true,clientFrameDHashes?,verificationOnly?})` queues once.
  Request replay must use the same order/upload/purpose/frame facts.
- `submissions.getReport({demoIdentity,submissionId})` returns state, authoritative
  source hash, hash provenance, stored canonical report, parsed observations and
  processing latency. Contributor sees own; controller/finance-agent are
  organization-scoped. Dashboard submission queries also expose the projection.
- `verificationOnly:true` grants only development verification rights and is
  rejected by `acceptAndPublish`. The CLI always uses this mode. A normal
  contribution still needs actual displayed license terms and consent.

```sh
pnpm verify:sample /absolute/path/to/clip.mp4
```

The development script reads only the Convex URL, uploads the given clip,
schedules verification, polls the existing submission and prints the stored
report (exit status 1 for a failed pipeline). It never reads the Gemini secret or commits media. A timeout does not
resubmit the clip. Use only a clip you are authorized to send for analysis.
The demo selectors are public/impersonable; production auth and private human
collection remain out of scope. No media download URL is exposed by this task.

## Limits and test evidence

Inputs are capped at 25 MiB and 30 seconds with bounded dimensions/output sizes;
subprocesses have timeouts and protocol restrictions. Missing audio, malformed
JSON, unavailable models and ordinary request timeouts store review-only failed
reports. A hard platform interruption triggers a separate watchdog Node action which
validates and stores a canonical failed/review report; stale completion cannot
replace it. A persistent storage/platform outage still requires operator inspection. There is no
unbounded retry or hidden automatic payment.

Unit/integration tests cover strict structured output, malicious narration,
missing/ambiguous evidence, unknown rubric semantics, timeout/malformed/provider
failures, byte hashing, real local FFmpeg separation, re-encoding, concurrent
temporary-file cleanup, role/consent checks, request replay and stale generations.
Mocks are not model accuracy or latency measurements.

## Implementation references

- [Convex Node runtimes](https://docs.convex.dev/functions/runtimes)
- [Convex external package installation](https://docs.convex.dev/functions/bundling)
- [Gemini inline image input](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini structured JSON](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini native transcription annotations](https://ai.google.dev/gemini-api/docs/transcribe)

## Deferred research

The Railway/Python worker, faster-whisper, SSCD copy descriptors, constrained
dense video alignment, learned acceptance heads and generalized action recognition
are deferred. Their context follows; none is required by this live Node demo.

## Training scope

The initial contribution is the implemented and evaluated verification pipeline, not a claimed foundation-model training run. After a baseline and labels exist, consider a small learned acceptance/ranking component over visual matches, narration matches, action order, visibility coverage, and copy-alignment statistics. Evaluate a simple logistic or tree model before a neural head. Preserve an untouched test set and report the comparison honestly.

VLM LoRA training, generalized action segmentation, unrestricted reidentification, synthetic-media detection, and downstream robotics policy training are later research. Do not make them prerequisites for a reliable demonstration.

## Open-weight alternative

Qwen3-VL-4B/8B plus separate ASR is a credible route when a suitable GPU and serving environment already exist. Qwen3-Omni is heavier: its official BF16 table lists theoretical minima around 68.74 GB for a 15-second Thinking input and 78.85 GB for Instruct. A model with 3B active parameters does not have a 3B total memory footprint. Quantized variants require a separate compatibility and latency test.

Grounding DINO can supply text-conditioned object proposals if necessary. Ultralytics YOLO is another option, but its AGPL/commercial licensing affects a project's license choice; a public repository alone does not establish compliance. Do not install either detector until the basic visual pass demonstrates a concrete need.

## Primary sources

- [Gemini models and model IDs](https://ai.google.dev/gemini-api/docs/models) (capabilities and listings do not establish this key's quota)
- [Gemini 3.8 Flash specifications](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) (current finance/`askAgent` default and model used in the historical Flash smoke tests; video now defaults to 4 Argon)
- [Gemini video input, FPS, clipping, and processing](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini model update and introductory pricing](https://ai.google.dev/gemini-api/docs/latest-model)
- [faster-whisper implementation and timestamp examples](https://github.com/SYSTRAN/faster-whisper)
- [Gemini 3.5 Transcribe model and feature limitations](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe)
- [Gemini file transcription API, verbatim mode, and word annotations](https://ai.google.dev/gemini-api/docs/transcribe)
- [SSCD implementation and pretrained descriptors](https://github.com/facebookresearch/sscd-copy-detection)
- [SSCD paper](https://arxiv.org/abs/2202.10261)
- [Meta ThreatExchange video hashing](https://github.com/facebook/ThreatExchange)
- [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/python)
- [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO)
- [Ultralytics licensing](https://www.ultralytics.com/license)
- [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- [Qwen3-Omni memory requirements](https://github.com/QwenLM/Qwen3-Omni#minimum-gpu-memory-requirements)
- [Audio–visual modality bias study](https://arxiv.org/abs/2604.02605)
- [Video timestamp citation verification preprint](https://arxiv.org/abs/2608.15574)


## Verify on-chain

The EAS integration commits finalized canonical reports, including failed or
review-only reports, to Base Sepolia. `reportHash` is SHA-256 of the exact UTF-8
bytes of the canonical stored `reportJson`; the action checks the existing hash,
source and frozen rubric bindings before sending. The eight public fields are
`reportHash`, `sourceSha256`, `rubricHash`, `pipelineVersion`, `videoModel`,
`recommendation`, `verifiedAt`, and `licensed`. `verifiedAt` is analysis completion
in Unix seconds, not the chain timestamp. `videoModel` lists the recorded visual
models separated by commas, or `unavailable`; model IDs and pipeline versions
must pass an allowlist rather than copying free-form model output.

The source and rubric hashes identify the bytes and criteria committed to, while
the report hash allows someone with authorized access to verify their report
copy. No original media, URL, narration, name, contributor wallet or report text
is published. Hashes can still correlate identical sources. `licensed: false`
is mandatory for verification-only uploads, including the YouTube test clips;
this metadata does not independently establish copyright ownership.

A separate two-minute sweep persists one durable intent per analysis and retries
failed attempts without blocking verification, acceptance or payments. Stable CDP
request IDs, a 23-hour automatic send-replay limit, log recovery and receipt/payload
checks prevent treating a timeout as proof of failure. An ambiguous older attempt
requires reconciliation rather than a fresh send. Confirmed receipts are bound
to the schema, attestor, zero recipient, exact encoded data and log index.

This is a provenance commitment, not an accuracy certificate or payment authority.
Revocable attestations use the existing [EAS Base Sepolia deployment](https://docs.attest.org/docs/quick--start/contracts),
with no Skarl contract or resolver. Schema/account/policy setup is live; see
[build status](status.md) for deployment and report backfill evidence, and the
[dashboard query contract](dashboard-api.md#verify-on-chain) for presentation.
