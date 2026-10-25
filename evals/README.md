# Evaluation harness

**Deferred for the event:** there is no labeled corpus before the deadline; tonight's evidence is the staged demo clips. The starter uses only the Python standard library. It validates split hygiene and scores supplied classification labels. It does not run models, inspect video, or produce measured AI results.

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
