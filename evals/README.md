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
2. Run `pnpm eval:clips /absolute/path/to/labeled-manifest.json`. The runner
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

The operational report remains review-only because evaluation clips have no
sale/training license. The nested, schema-validated
`observations.evaluation.qualityReport` is an **advisory content-quality
projection** computed before adding that licensing warning. Every inference,
media, injection, ambiguity and duplicate warning is retained. This report
cannot create a payable; `finance.acceptAndPublish` still refuses the entire
verification-only submission.

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

Video verification defaults to `gemini-4-argon`. Finance and `askAgent` keep
`gemini-3.8-flash`. To compare video models, use the same private, pre-labeled
manifest in both arms:

```sh
pnpm eval:clips /absolute/path/to/labeled-manifest.json --compare-video-models
# Resume the parent comparison, including incomplete child submissions:
pnpm eval:clips /absolute/path/to/labeled-manifest.json --compare-video-models --resume /absolute/path/to/comparison.json
# Or request one specific video model:
pnpm eval:clips /absolute/path/to/labeled-manifest.json --video-model gemini-4-argon
```

The parent freezes the model list, exact manifest bytes and source hashes before
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

Runner version `real-clips-v2` refuses older checkpoints or changed runner sources,
labels, splits or model selections. To resume an explicit single-model run, pass
its original `--video-model` again. All artifacts and recordings remain ignored
and private. No labeled multi-clip A/B accuracy benchmark has been measured by
this implementation; mocked tests validate orchestration and metric computation.
