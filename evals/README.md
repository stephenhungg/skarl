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
