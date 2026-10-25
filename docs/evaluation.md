# Evaluation protocol

Status: protocol and synthetic metadata examples. No media corpus, model predictions, or measured AI results are included. A passing manifest check validates dataset organization, not inference quality.

**Not yet run.** There is no labeled corpus for this protocol yet. Current evidence is the three staged clips in [demo](demo.md) (valid, re-encoded duplicate, narration mismatch); present them as demo cases, never as a benchmark or held-out result.

## Initial task family

Use a fixed camera, clearly distinguishable red and blue cups, one marked coaster, English narration, and 10–30 second recordings. These are capture constraints, not evidence that the system generalizes to arbitrary demonstrations.

Label the requested object, pickup interval, placement interval, placement target, spoken claims, visibility, and final rubric outcome. Record who labeled each example and how disagreements were resolved. Keep expected labels hidden from the inference prompt and adapters.

## Dataset groups

Collect valid demonstrations and deliberately difficult negatives:

| Family | Example | Expected behavior |
| --- | --- | --- |
| Valid | Correct object, action order, placement, and narration | Supported criteria; acceptance may be proposed |
| Object conflict | Says red but moves blue | Identify cross-modal mismatch |
| Sequence conflict | Places first, then picks up | Identify order failure |
| Spatial conflict | Places beside the coaster | Identify unsupported target placement |
| Audio missing | No speech or unintelligible speech | Unobservable narration; request correction/review |
| Visual missing | Hand obscures placement or action leaves the frame | Unobservable action; request another view |
| Exact copy | Same file submitted again | Exact match candidate |
| Edited copy | Crop, re-encode, trim, overlay, resolution or modest speed edit | Likely copy candidate with matching intervals |
| Independent retake | Same person, cups, room, task, but a new performance | Do not treat semantic similarity alone as copying |
| Changed recording conditions | Different lighting, angle, person, or background | Measure robustness and review behavior |

Changing only a spoken object name while keeping the video fixed is a useful cross-modal counterfactual. Include cases where both audio and video are independently correct but describe different objects. An action being briefly visible is different from the action being absent.

## Split policy

Split original recordings before creating derived copies. Group by contributor/actor and recording session. Every crop, re-encode, trim, and other derivative stays in its original recording's split. Do not put neighboring frames or variants of one recording in both train and test.

The manifest checker rejects an actor, session, or origin group appearing in multiple splits. This is intentionally conservative. A future dataset can define a different explicit generalization split, but must not silently relax it to increase the score.

Use training for learned components, validation for thresholds and capture decisions, and test only for the frozen final comparison. Record all retests after changes; do not keep selecting the best test run. If a test case informs a fix, move it into development and collect a new untouched test case.

## Baselines and ablations

1. Exact SHA-256 matching.
2. Sampled-frame perceptual hashing.
3. SSCD descriptors plus temporal alignment.
4. One direct audio–video model prompt using the same rubric.
5. Silent video observations plus separate ASR and evidence comparison.
6. The same decomposed pipeline with targeted denser event inspection.

Hold the semantic model, rubric, and generation settings fixed when isolating pipeline improvements. Compare equivalent input conditions and record differences in media sampling or transcript availability. A snapshot-only baseline must be identified as such; it is not the same as a full video model baseline.

## Metrics

Report raw counts and sample counts alongside rates:

- Rubric criterion precision/recall and false acceptance rate, by failure family.
- Object-reference accuracy and temporal evidence support accuracy.
- Event localization error against labeled intervals; optionally temporal IoU for spans.
- Duplicate precision/recall, edited-copy recall by transformation, and false positives on independent retakes.
- Review coverage and unresolved-case rate. A model that reviews everything should not appear perfectly autonomous.
- Correct clarification and final decision after clarification.
- Repeatability on identical inputs, using all repeated outcomes.
- End-to-end p50/p95 duration, model-call count, input/output/thinking usage, worker time, and cost per submission and per accepted submission.

Treat an `unobservable` or review outcome separately from an acceptance or rejection. Show AI-only recommendations separately from human-reviewed final results. Do not hide failures behind a human-corrected headline score.

The offline scorer reports classification counts, Wilson intervals, criterion
agreement and a selective-prediction operating point from supplied predictions.
It never runs or independently verifies inference. The cloud runner separately
records measured request/report latency; neither tool establishes confidence
calibration, localization accuracy or cost without the corresponding data.

### Uncertainty, agreement and selective prediction

Both Python and JavaScript use two-sided Wilson 95% intervals (`z = 1.959963984540054`).
Report the count and denominator alongside each interval. Zero false acceptances
in a small test set is not proof of a zero false-acceptance rate:

| False accepts / negative cases | Wilson 95% interval |
| --- | --- |
| 0 / 15 | [0.000, 0.204] |
| 0 / 20 | [0.000, 0.161] |
| 1 / 15 | [0.012, 0.298] |

`falseAcceptance.ci95` uses every labeled non-accept case as its denominator,
including failed analyses. `failureAdjustedDecisionAccuracyCi95` uses all cases
and credits only successful correct decisions. `conditionalDecisionAccuracyCi95`
uses successful analyses only. Empty denominators produce `null`, not zero.
The offline raw classification summaries remain descriptive supplied-label
agreement; exported `successfulAnalysis` metadata makes the operational metrics
agree with the cloud runner, without turning that metadata into independent proof.

`criterionAgreement` pools successful-analysis criterion pairs against the
supplied human/expected labels. It records Cohen's kappa and a confusion matrix:
rows are human/expected statuses, columns are predicted statuses, ordered as
`contradicted`, `supported`, `unobservable`. Kappa is `null` with no pairs or
degenerate single-class perfect agreement. Keep the matrix and pair count with
kappa; high agreement on a dominant class alone is not enough.

`riskCoverage` reports one operating point: coverage is successful `accept` or
`request_correction` recommendations divided by all cases; risk is incorrect
recommendations divided by those auto-decided cases. `needs_review`, failed and
incomplete analyses abstain. With no auto-decisions, risk is `null`. These are
advisory recommendations, not authorization to accept work or move money.

The Markdown reports display these intervals, kappa/confusion matrix and
risk-coverage counts; the paired-model table compares the same metrics across
the frozen case inventory. These are descriptive binomial intervals, not
conformal abstention guarantees. Derived clips and criteria within a clip are
correlated; do not present pooled criterion pairs as independent trials or
claim calibrated safety from a small staged corpus. Conformal guarantees remain
future work requiring a suitable held-out calibration set and assumptions.

## Finance integration checks

These are deterministic system checks, separate from AI accuracy:

- Replaying a verification callback cannot create a second acceptance or payable.
- A likely duplicate does not create an accepted-sample payment automatically.
- A changed rubric creates a new version and does not rewrite previously approved terms.
- A controller rejection does not mark a payout as settled.
- Unknown/pending Base Sepolia transactions are reconciled before retrying a transfer.
- Debits equal credits; received funds, delivered order value, open obligations, contributor payables, payments, and refunds agree.
- The verifier cannot approve payments, invoke a wallet signer, or write accounting entries.

## First experiments

1. Compare 1 FPS and denser sampling on fast and slow pickup/release recordings.
2. Compare a direct audio–video prompt with separate observations on conflicting narration.
3. Find whether copy scores separate transformed copies from independent retakes.
4. Hide the placement and check that the system requests evidence rather than inventing it.
5. Run the same recording several times with pinned settings to measure variation.

Stop expanding the model stack until these tests support the narrow use case. If evidence is insufficient, keep human review and report the limitation.

## Commands and honest reporting

From the repository root:

```sh
python3 evals/evaluate.py --manifest evals/manifest.example.json --check-manifest
python3 evals/evaluate.py --manifest evals/manifest.example.json --predictions evals/predictions.example.json
```

The supplied examples are synthetic metadata with no media. The output labels their scores as synthetic plumbing checks. They must not be used as an AI benchmark in the submission. Add real recordings and independently labeled predictions to make an inference claim.

## Primary references

- [Gemini video sampling limitations and controls](https://ai.google.dev/gemini-api/docs/video-understanding)
- [SSCD image-copy detection paper](https://arxiv.org/abs/2202.10261)
- [SSCD implementation and evaluation material](https://github.com/facebookresearch/sscd-copy-detection)
- [Audio–visual evidence conflict research](https://arxiv.org/abs/2604.02605)
- [Video citation verification study](https://arxiv.org/abs/2608.15574)

## Video model comparison

Compare `gemini-4-argon` and `gemini-3.8-flash` on identical frozen source hashes,
labels, rubric, media sampling and audio configuration. Hold the non-video
pipeline fixed and keep a separate duplicate scope for each model so the
second model’s upload is not scored as a copy of the first model’s input.
Run both models, or select one explicitly:

```sh
pnpm eval:clips <manifest.json> --compare-video-models
pnpm eval:clips <manifest.json> --compare-video-models --resume <comparison.json>
pnpm eval:clips <manifest.json> --video-model gemini-4-argon
```

The runner’s [usage instructions](../evals/README.md#run-actual-local-clips)
cover the model-specific artifacts and resume rules. Expected labels stay out
of model input; a model-specific verification-only override must not change
the shared deployment setting.

Report decision accuracy, false-acceptance count/rate, review rate, inference
coverage and latency per model over the same sample inventory. Retain provider
failures in failure-adjusted accuracy and show conditional accuracy separately.
A faster model or a clearer visibility response in a small frame probe does
not establish better labeled task accuracy. The current Argon video default
comes from the team’s directional frame probe, not a completed corpus evaluation.

### Default jury versus model-specific evaluation

Ordinary submissions with no `evalVideoModel` use a default-on panel:
`gemini-4-argon` and `gemini-3.8-flash` independently observe the same silent
frames while one separate model transcribes audio. Deterministic reports compare
each model's criterion statuses. Disagreement or either visual failure forces
review, with Argon retained as the primary observations. `observations.jury`
records both advisory reports and the agreeing-criteria fraction; failed visual
or audio analysis has `null` agreement. Both visual attempts remain in model-run
metadata. Agreement from two Gemini models is not proof of correctness.

`VERIFIER_JURY=off` selects the prior single-model deployment path. Explicit
`evalVideoModel` overrides always bypass the panel, so paired Argon/Flash
experiments remain isolated single-model runs. The default clip-runner invocation
without an override measures the configured deployment panel. Report that mode,
all actual model IDs, review coverage and request counts with results; never
compare a panel arm to a single-model arm under an unlabeled common name.

The panel has mocked regression coverage for agreement, disagreement and provider
failure. No labeled human corpus measurement or live panel-quality claim is made.

## Implemented cloud clip runner

Use `pnpm eval:clips <manifest.json>` for the mini evaluation. See the
[runner instructions and manifest template](../evals/README.md#run-actual-local-clips).
Labels and source hashes are frozen before network work; real uploads trigger
the existing Convex verifier. Results are local dated JSON plus a Markdown
metrics table. Generated artifacts and recordings are not committed.

The scored recommendation is the validated pre-licensing advisory quality
report, while the operational report and the financial guard keep evaluation
submissions ineligible for payment. Evaluation copy comparisons are scoped to
the run, and dependencies execute in manifest order. Failed providers, blocked
cases and client timeouts remain visible in the denominator and coverage; no
failed review fallback is credited as a correct model decision. No real corpus
accuracy is claimed merely because the runner tests pass.
