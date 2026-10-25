# Evaluation harness

The offline Python scorer validates split hygiene and supplied classification labels. The `pnpm eval:clips` runner adds actual uploads and scheduled cloud verification over pre-labeled local recordings. No labeled human corpus or accuracy benchmark is committed; the example below is a template, not measured evidence.

```sh
python3 evals/evaluate.py --manifest evals/manifest.example.json --check-manifest
python3 evals/evaluate.py --manifest evals/manifest.example.json --predictions evals/predictions.example.json
python3 -m unittest discover -s evals/tests
```

Both example files are synthetic metadata. Predictions include an intentional false positive on an independent retake so the plumbing demonstrates a failure count. Their scores have no model-quality meaning. The output states `synthetic_plumbing_only` and `inferenceRan: false`.

Each manifest sample identifies its actor, recording session, original recording, split, variant, optional media path, and expected criterion/duplicate/recommendation labels. An actor, session, or original recording cannot occur across multiple splits. All edited derivatives remain with their original. Real manifests must set `syntheticMetadata: false` and provide media references; this checker validates those references structurally, not the file contents.

The scorer requires exactly one prediction for every sample in the chosen split and matching criterion coverage. It fails on missing, duplicate, or extra samples. This avoids a misleading perfect score obtained by omitting hard examples. `--split` defaults to `test`.

Full evidence reports are governed by `packages/contracts/schemas/verification-report.schema.json`; the small scoring prediction format is a separate label projection. Future inference tooling must produce that projection from real reports while preserving run IDs and provenance. Keep expected labels inaccessible to the model.

See [the full protocol](../docs/evaluation.md) for media collection, ablations, calibration, localization, cost measurements, and finance integration checks.

## Run actual local clips

1. Copy [the clip manifest template](clips.manifest.example.json), replace every
   placeholder path/hash and label each recording before running. Include the
   exact frozen rubric criterion IDs. Keep the recordings private. Set
   `syntheticMetadata: false`; synthetic scoring fixtures cannot run inference.
2. For prerecorded **content-quality** labels, explicitly opt in with
   `pnpm eval:clips /absolute/path/to/labeled-manifest.json --content-only`. The runner
   validates the complete manifest and all source hashes locally, then freezes
   labels/provenance into a dated result before any network work. Expected labels
   never enter a submission or model request. All uploads are verification-only.
3. Inspect the dated JSON and Markdown table under `evals/results/` (ignored).
   Preserve partial artifacts and resume the existing run with the documented
   `--resume` option instead of uploading the same cases as a new evaluation.

The backend uses a distinct `evalRunId` copy corpus and compares cases
sequentially. An edited copy must name a prior reference via `duplicateOf`;
failed references block dependent cases. The runner checks for unexpected
submissions in its scope. Normal production submissions exclude evaluation
cases from their analysis corpus; the accepted-work financial duplicate gate
remains global.

### Choose the measurement protocol before freezing labels

**Default (no `--content-only`): capture quality including actual liveness.** The
normal liveness policy is unchanged. This local-file runner does not attach or
invent per-take challenges; an ordinary prerecorded upload therefore receives a
missing-challenge warning and `needs_review`, even when the cup actions are
supported. Use this mode to measure the full gate's review behavior. It cannot
establish a fresh spoken-liveness pass or positive acceptance accuracy from old
recordings.

**Explicit `--content-only`: prerecorded content quality; liveness NOT TESTED.**
Freeze labels for the visible/narrated red-cup task and copy detection only. The
submission persists immutable `evalContentOnly:true` alongside verification-only
scope and `evalRunId`; the backend refuses ordinary/unscoped use, supplied
liveness challenges, changed replays or mixed capture/content corpora. No
challenge is fabricated after recording. This is a versioned
`content-only-no-liveness-v1` advisory projection with `contentOnly:true` and
`livenessTested:false` in `observations.evaluation`.

The backend independently constructs the full operational report with the real
missing-liveness warning and licensing guard. Both reports use identical source,
rubric, model runs, criteria and evidence. The only permitted difference is adding
the genuine missing-challenge warning plus the verification-only licensing guard,
forcing operational `needs_review` (or retaining failure). Every other inference,
media, injection, ambiguity and duplicate warning is preserved verbatim; content
mode never clears a warning-bearing report into acceptance.

All uploads remain operationally ineligible for acceptance, dataset publication,
training licensing and payment. `finance.acceptAndPublish` refuses the entire
verification-only submission, including explicit human overrides. A content
recommendation named `accept` means its measured content checks passed; it is
not an accepted contribution, a liveness result or a payout decision.

JSON and Markdown label the measurement scope and whether liveness is included
or not tested. Operational stored-report/review/failure counts and zero
acceptance eligibility are shown separately. Content false-acceptance measures
content-label errors, **not payout accuracy or production fraud resistance**.

Metrics include failure-adjusted decision accuracy, conditional accuracy and
coverage, false-acceptance count/rate, review rate and nearest-rank p50/p95
latency. Provider failures cannot earn a correct answer merely by matching an
expected review label. Client timeouts are censored, not completed latency
samples. The raw `evaluate.py` output remains labeled `inferenceRan: false`
because Python only scores supplied projections; the outer runner records the
actual cloud inference attempts and their provenance. If report coverage is
incomplete, raw scoring is explicitly unavailable rather than fabricated.

A staged 15–20 case run can demonstrate observed failure modes and latency; it
is not a held-out generalization claim. The existing synthetic examples still
exercise only scoring plumbing and remain unchanged.

## Compare Argon and Flash on the same clips

Ordinary verification defaults to an Argon/Flash visual jury with separate
audio. Explicit model comparisons remain single-model arms. The single visual
default (`VERIFIER_JURY=off`) is `gemini-4-argon`; Gemini finance and `askAgent`
default to `gemini-3.8-flash`. To compare video models, use the same private, pre-labeled
manifest in both arms:

```sh
pnpm eval:clips /absolute/path/to/labeled-manifest.json --compare-video-models --content-only
# Resume the parent comparison, including incomplete child submissions:
pnpm eval:clips /absolute/path/to/labeled-manifest.json --compare-video-models --content-only --resume /absolute/path/to/comparison.json
# Or request one specific video model:
pnpm eval:clips /absolute/path/to/labeled-manifest.json --video-model gemini-4-argon --content-only
```

These examples explicitly measure prerecorded content. Omit `--content-only` in
both the original and resume invocations to measure the full liveness gate.

The parent freezes the measurement mode, model list, exact manifest bytes and source hashes before
network access. Both arms must use the same frozen order/rubric and pipeline
version. Argon runs first, then Flash, each with a distinct `evalRunId` duplicate
corpus; reference/copy relationships remain within that arm. This avoids counting
the second model's first clip as a duplicate of the first model's upload. Audio
inference runs independently in each arm and its actual model metadata remains
in the child reports. Sequential timing is not a randomized latency experiment.

An allowlisted `evalVideoModel` is stored with each scoped verification-only
submission, bound on replay, and passed to the actual visual request. Ordinary
contributions cannot select an evaluation override. The runner never changes a
global Convex environment variable and rejects reports whose requested/actual
video model differs. Finance and payment authority remain unchanged.

The parent JSON and Markdown table compare **per model**: inference coverage,
failure-adjusted decision accuracy, false-acceptance count/rate, review rate,
and nearest-rank p50/p95 visual-request, backend and client latency. Individual
child artifacts retain conditional accuracy, raw scorer output, timeout censoring,
source hashes, actual model runs and all validated reports. Failed inference
receives no correct-decision credit. A partial arm remains partial and resumable;
completed submissions are not uploaded again. Parent checkpoint paths are saved
before child network work so interruption can resume the existing submissions.

Runner version `real-clips-v3-content-scope` refuses older checkpoints or changed
runner sources, labels, splits, model selections or measurement modes. To resume an explicit single-model run, pass
its original `--video-model` again, and repeat `--content-only` when that mode
was frozen. All artifacts and recordings remain ignored
and private. No labeled multi-clip A/B accuracy benchmark has been measured by
this implementation; mocked tests validate orchestration and metric computation.
