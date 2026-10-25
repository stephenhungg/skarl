# Evaluation protocol

Status: protocol and synthetic metadata examples. No media corpus, model predictions, or measured AI results are included. A passing manifest check validates dataset organization, not inference quality.

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

The starter scorer reports only classification counts from supplied predictions. It does not calculate confidence calibration, localization, model latency, or costs unless an implementation and data for those metrics are added.

## Finance integration checks

These are deterministic system checks, separate from AI accuracy:

- Replaying a verification callback cannot create a second acceptance or payable.
- A likely duplicate does not create an accepted-sample payment automatically.
- A changed rubric creates a new version and does not rewrite previously approved terms.
- A controller rejection does not mark a payout as settled.
- Unknown/pending Solana Devnet transactions are reconciled before retrying a transfer.
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
