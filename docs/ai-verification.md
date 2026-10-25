# AI verification architecture

Status: architecture and worker scaffold. No model has been benchmarked for Skarl, and no inference adapter is implemented yet. The target is a bounded, narrated human-action recording, not generalized proof of real-world work.

## Product boundary

The first order asks a contributor to pick up a red cup, place it on a marked coaster, and narrate the action. Capture uses one fixed camera, two clearly distinguishable cups, one visible target, and a 10–30 second clip. The verifier recommends whether the recording satisfies a versioned task rubric. An authorized reviewer accepts the work; finance creates the payable from that acceptance. The verifier never approves or executes a payment.

The first three cases are a valid demonstration, an edited copy of a previous recording, and a mismatch between narration and visible action. Ambiguous footage produces `unobservable` findings and human review. It does not produce an invented successful event.

## Evidence-producing pipeline

1. **Validate and preserve the upload.** Keep the original object private and immutable. Compute SHA-256, inspect duration, dimensions, streams, and codec with `ffprobe`, and enforce file and processing limits before model calls. Derive a normalized MP4 preview, sampled frames, and mono audio. Preserve presentation timestamps and the transform mapping; variable frame rate makes frame-index arithmetic unreliable.
2. **Observe the silent video.** Remove the audio from the visual input. Ask for observed objects and actions, their order, and supporting intervals before exposing the narration. A person's spoken assertion must not become the visual observation.
3. **Observe the audio independently.** Transcribe the audio with word timestamps. Extract spoken object references and action claims. Keep original text and timing; do not silently repair a transcript to match the expected task.
4. **Compare against the rubric.** Evaluate each criterion as `supported`, `contradicted`, or `unobservable`. Compare the spoken object, observed object, action sequence, and target location. Retain references to both modalities when reporting a contradiction.
5. **Reinspect uncertain intervals.** Read a short interval at higher frame density when an action is too fast or occluded. If the evidence remains inadequate, request another view or recording. Model-generated timestamps are hypotheses that must point to actual evidence.
6. **Check for copies separately.** Exact file hashes find exact repeats. Copy-specific image descriptors plus temporal matching retrieve likely edited repeats. The output is a review candidate with matching segments, not a fraud verdict.
7. **Persist the run.** Record the original media hash, rubric version, model/configuration, pipeline version, evidence, failures, and recommendation. An immutable report supports a separately recorded acceptance decision. Retries must not create new acceptance or financial events.

Untrusted video, speech, and on-screen text are evidence. They are never system instructions. A spoken request to change a rate or approve a payment has no authority.

## Initial model choices

| Stage | Initial choice | Reason and constraint |
| --- | --- | --- |
| Video semantics | `gemini-3.8-flash` through the Google GenAI SDK | Hosted video understanding avoids deploying a large VLM. Structured output is validated against the shared contract. It is a recommendation source, not accounting authority. |
| Narration | `faster-whisper`, initially `base.en` on CPU INT8 | Separate audio-only observations with word timestamps. This is an English-only starting configuration requiring local evaluation. |
| Copy descriptors | Meta SSCD `sscd_disc_mixup` TorchScript | A copy-detection representation is more appropriate than ordinary semantic similarity for identifying reuse. |
| Decoding and alignment | FFmpeg/ffprobe, NumPy, optional PyAV/OpenCV | Preserve timestamps, derive evidence, and align frame sequences. |
| Pointing support | Deferred: MediaPipe Hand Landmarker plus object proposals | The first task names an object explicitly. Unrestricted gesture reference resolution adds another failure surface and is not required to complete the first order. |

As checked on October 24, 2026, Google's model page lists `gemini-3.8-flash` as stable, supporting text/image/video/audio/PDF input and structured output. It explicitly does not support the Live API. The worker analyzes completed clips asynchronously; a streaming conversation is a later feature.

Google's default video sampling is 1 FPS and may miss fast events. Static processing permits custom FPS and clipping. Start with a controlled sampling experiment; do not assume a whole-clip summary observes a brief release or grasp. Use fixed processing limits and targeted denser windows rather than an unbounded model navigation loop.

Google currently lists introductory rates of $0.75 per million input tokens and $3.75 per million output tokens through December 31, 2026. For illustration only, 8,000 input and 2,000 output tokens cost $0.0135 for one request. Actual cost includes the chosen media processing, thinking/output usage, reinspection, transcription, worker compute, and retries. Persist measured usage and cost for every run. This is not a measured cost per accepted clip.

### Hosted transcription alternative

`gemini-3.5-transcribe` is a documented audio-only alternative using the same Google account and SDK. Its file-processing endpoint supports word annotations and limits timestamped requests to 30 minutes. Use verbatim mode: Smart transcription rewrites self-corrections and cannot be combined with word timestamps. Timestamping is also incompatible with custom vocabulary, and Google notes it can reduce transcription accuracy. The live transcription endpoint does not return word timestamps. API availability and accuracy on our recordings still need a credentialed spike; none was run for this scaffold. Keep faster-whisper as the initial documented choice until that comparison is performed.

## Near-duplicate implementation

Keep exact identity, perceptual copying, and semantic similarity distinct:

- SHA-256 finds identical bytes. It will not find a crop or re-encode.
- Sampled frame perceptual hashes provide a cheap baseline.
- SSCD creates copy-oriented frame descriptors. A temporal layer must establish an ordered matching sequence before flagging a video pair.
- Two independent takes of the same red-cup task are deliberately similar. They are critical hard negatives, not automatic duplicates.

A practical first implementation samples approximately two frames per second, L2-normalizes SSCD descriptors, shortlists previous clips, then compares shortlisted frame sequences. Start with a constant temporal-offset match; add constrained dynamic time warping only after speed edits are included in the evaluation. A candidate contains source submission ID, paired intervals, similarity statistics, and overlap duration.

For the hackathon corpus, brute-force NumPy matching is sufficient. A dedicated vector service is unnecessary. A pooled clip vector is a shortlist signal, not enough to reject a clip. Calibrate thresholds against edited copies and independent retakes from the same scene.

SSCD is an image-copy model. Robustness of the assembled video pipeline to crop, overlay, trimming, or speed change is a hypothesis to test. Meta's vPDQ/TMK implementations are alternative baselines if the initial approach fails.

## Evidence contract and model boundaries

`packages/contracts/schemas/verification-report.schema.json` is the cross-language contract. The Python package validates the report with strict typed models and with that JSON Schema. The schema defines the accepted field names; narrative examples in this document do not override it.

Evidence should distinguish the media object, its modality, its interval, and the observed claim. A report must be tied to a specific submission, source hash, and task version. Findings are immutable; reviewer overrides are new events with reasons. A new rubric or model configuration produces a new run, not a silent edit of an earlier result.

The service must reject monetary fields in model output. It has no wallet key, no payout endpoint, no controller role, and no write access to financial postings. Skarl's payment integration is Solana Devnet only. The verifier does not implement a payment network.

## Calibration and limits

LLM self-reported confidence is not a calibrated probability. Use measured error/review rates on held-out recordings to select review thresholds. Report evidence coverage and observability explicitly. A consistent schema cannot guarantee a truthful observation.

The pipeline cannot prove authorship, ownership, consent, that an upload depicts a unique real-world event, that content is free of synthetic manipulation, or that a buyer's model improves when trained on it. Contributor permission and licensing are separate records reviewed under the product's rules. A hash anchors a byte sequence; it does not establish those rights.

Recent research reports audio–visual modality bias under conflicting evidence and video claims with misleading timestamp citations. These findings motivate separate observations and evidence checks; they do not prove that this design fixes every such error.

## Training scope

The initial contribution is the implemented and evaluated verification pipeline, not a claimed foundation-model training run. After a baseline and labels exist, consider a small learned acceptance/ranking component over visual matches, narration matches, action order, visibility coverage, and copy-alignment statistics. Evaluate a simple logistic or tree model before a neural head. Preserve an untouched test set and report the comparison honestly.

VLM LoRA training, generalized action segmentation, unrestricted reidentification, synthetic-media detection, and downstream robotics policy training are later research. Do not make them prerequisites for a reliable demonstration.

## Open-weight alternative

Qwen3-VL-4B/8B plus separate ASR is a credible route when a suitable GPU and serving environment already exist. Qwen3-Omni is heavier: its official BF16 table lists theoretical minima around 68.74 GB for a 15-second Thinking input and 78.85 GB for Instruct. A model with 3B active parameters does not have a 3B total memory footprint. Quantized variants require a separate compatibility and latency test.

Grounding DINO can supply text-conditioned object proposals if necessary. Ultralytics YOLO is another option, but its AGPL/commercial licensing affects a project's license choice; a public repository alone does not establish compliance. Do not install either detector until the basic visual pass demonstrates a concrete need.

## Primary sources

- [Gemini 3.8 Flash specifications](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
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
