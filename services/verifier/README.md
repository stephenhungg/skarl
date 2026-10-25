# Skarl verifier

Python 3.11+ contract and CLI scaffold for advisory multimodal verification. Inference adapters are **not implemented**. Installing an ML dependency does not enable them. The service has no payment authority, wallet key, or financial posting endpoint.

## Core setup

From the repository root, using a Python 3.11 environment:

```sh
python3 -m venv services/verifier/.venv
services/verifier/.venv/bin/python -m pip install -e 'services/verifier[dev]'
services/verifier/.venv/bin/skarl-verifier --help
services/verifier/.venv/bin/skarl-verifier validate-report services/verifier/examples/scaffold-report.json
services/verifier/.venv/bin/python -m pytest services/verifier/tests
```

Core dependencies have compatible major-version bounds. Before deployment, resolve actual versions in the target environment, record a lock file and model artifact hashes, and check the resulting runtime. Do not invent version pins or install the optional ML stack merely to make the scaffold appear complete.

The `ml` extra is a candidate dependency set for later implementation. PyTorch, CTranslate2/faster-whisper, and Torchvision compatibility depends on Python version and target hardware. A CPU package validation on a newer Python is not proof that the ML stack works there. FFmpeg/ffprobe are separate system tools.

## Commands

```sh
skarl-verifier validate-report path/to/report.json
skarl-verifier validate-report path/to/report.json --schema packages/contracts/schemas/verification-report.schema.json
skarl-verifier validate-report path/to/report.json --task-spec path/to/trusted-order-task-spec.json --criterion-id task-adherence
skarl-verifier scaffold-report --submission-id demo --task-version-id red-cup-v1 --sha256 0000000000000000000000000000000000000000000000000000000000000000 --duration-ms 12000
skarl-verifier analyze path/to/recording.mp4
```

`validate-report` performs typed validation and canonical JSON Schema validation. It does not run inference. `scaffold-report` produces an explicit `ml_unavailable` / `needs_review` report. `analyze` exits with code 4 and performs no upload, inference, or payment. Other validation failures exit 2.

The canonical schema is `packages/contracts/schemas/verification-report.schema.json`. Missing schema files fail clearly; the package does not silently substitute a weaker schema. Installed outside the repository, pass `--schema` explicitly.

## Planned worker boundary (deferred)

For the demo, analysis runs as Gemini calls in a Convex action; this package supplies the canonical report validation and tests. The deferred future worker receives a narrowly authorized media reference, immutable task version, and submission ID; runs bounded analysis; and returns a validated report through an authenticated, report-only callback. Its credentials must not allow accepting a submission, changing a price, creating a payable, approving a payment, or invoking any wallet signer.

Reports use `schemaVersion: "1.0"`, criterion findings of `supported`, `contradicted`, or `unobservable`, and an advisory recommendation. Scaffold, failed, incomplete, or unavailable runs must recommend `needs_review`. Acceptance recommendations require completed inference, all criteria supported, and a clear duplicate check. Application code also checks timestamp bounds and duplicate references.

`task-evidence-2.0` reports may include separate `observations.video` and `observations.audio` records with timestamped object and target labels. Shape validation allows bounded strings; scoped validation additionally checks labels against the trusted order's `object`, `distractors`, and `target`, with `other` and `unknown` fallbacks. Supply `--task-spec` with the rubric criteria when validating these reports for an order. Report text and narration cannot provide the spec. `red-cup-evidence-1.2` reports retain their original labels and remain readable without adding observation metadata. Python remains a contract validator; the live Convex action owns inference.

See [AI architecture](../../docs/ai-verification.md) and [evaluation protocol](../../docs/evaluation.md). Skarl's payment implementation is Base Sepolia only; this package has no blockchain implementation.
