# Replay studio

The submission detail page has a Replay studio section. It shows the original beside stored jury, narration, liveness, sensor and source-check witnesses. Browser models add advisory overlays; they cannot change a verdict, acceptance, delivery, payable or payment destination.

## Browser models

All heavy libraries are dynamically imported only when a model is requested. Model download progress, the actual model version and the actual runtime are shown beside each layer. Model assets require access to their public CDNs. Original video pixels stay in the browser during inference; annotation JSON is uploaded only when Save annotations is pressed.

| Layer | What runs | Runtime and source |
| --- | --- | --- |
| Hands | MediaPipe Hand Landmarker, float16 model version 1, two hands, VIDEO mode | `@mediapipe/tasks-vision@1.1.1`, WASM/CPU; [official model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task), [Google web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) |
| Objects | MediaPipe EfficientDet-Lite0, float32 model version 1, score threshold 0.4 | Same MediaPipe runtime, WASM/CPU; [official model](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite), [Google web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector/web_js) |
| Masks | Actual SAM2.1 Hiera Tiny, single positive click on a paused image | `@huggingface/transformers@4.3.1`, WebGPU fp16 when supported, WASM q8 otherwise; [ONNX conversion](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/tree/814a066640debee5a91e70aa401fb8e17e030503), pinned revision `814a066640debee5a91e70aa401fb8e17e030503` |

EfficientDet is the requested fallback to YOLO. No YOLO or Ultralytics code/model runs here. Ultralytics YOLO is offered under AGPL-3.0 or an enterprise license; replacing the detector would require reviewing the [Ultralytics licensing terms](https://www.ultralytics.com/license). MediaPipe and Transformers.js use Apache-2.0. The [upstream SAM2.1 model card](https://huggingface.co/facebook/sam2.1-hiera-tiny) states Apache-2.0; the pinned community ONNX repository has no model card. Conversion provenance and that missing card are disclosed rather than presented as an independently audited model license.

The installed Transformers.js package exports `Sam2Model` and `Sam2Processor`, and both actual browser runtimes were exercised with synthetic imagery. This uses SAM2.1 image segmentation, not temporal mask propagation or SlimSAM. The selected mask displays its pixel fraction and normalized bounds and remains local to the replay. The selected region is hidden when playback leaves the selected frame.

Hand x/y are clamped image-normalized coordinates. MediaPipe's native z is signed and wrist-relative, not normalized image depth. To meet the shared v1 schema's unit-coordinate contract, saved z is `clamp(nativeZ + 0.5, 0, 1)`. This lossy encoding is disclosed in the UI; it is not metric 3D position. Handedness follows the model's unmirrored source-image convention.

Cup-in-hand is only an overlap of a detected cup rectangle and a landmark bounding rectangle. It does not prove a grasp, object identity, success, or rubric compliance. Live hands/objects are inferred at approximately 5 fps and drawn on decoded video frame callbacks. Saved runs are shown only within 150 ms of a sampled frame. Model graph timestamps increase across seeks while JSON timestamps remain the original video clock.

## Evidence and media access

`media.submissionEvidence` is the source for the role-checked original URL, timestamped transcript and optional sensor trace. The player sets `crossOrigin="anonymous"`. A failed direct load or tainted segmentation canvas switches to `/api/replay/media`, which accepts only an already issued bearer URL on the configured Convex origin and its `/api/storage/…` path. It rejects other origins, embedded credentials, query strings, redirects and nonvideo responses, forwards a single byte range for seeking, and uses private/no-store responses. It does not mint a new controller grant or bypass the underlying URL's bearer access. Do not publish original storage URLs or proxy URLs.

Stored jury model IDs and pipeline versions are shown without inventing a separate model revision. Scaffold/unavailable results produce no supporting evidence. Spoken liveness uses the shared deterministic challenge/transcript comparator and seeks to the containing segment, not an invented word timestamp. Sensor curves are browser-derived 100 ms mean magnitudes in their original units, with missing bins left as gaps. Device clock alignment and stored steadiness/tilt/active intervals remain client-reported. Optional quality and receipt APIs fail visibly without preventing playback. Quality is an advisory heuristic, not acceptance authority.

## Annotation contract and deployment

The frontend uses exactly these additive endpoints:

- `annotations.forSubmission({demoIdentity, submissionId})`, newest-first runs with model, creator, time, signed URL and summary.
- `annotations.generateUploadUrl({demoIdentity, submissionId})`, followed by a JSON POST to that URL.
- `annotations.saveDerived({demoIdentity, submissionId, storageId, summary})` after each upload.

The controller dashboard uses its existing controller selector; it does not add authentication rules. Backend authorization must enforce controller/order buyer/owning contributor reads and controller/owning contributor uploads. This implementation changes no Convex function or auth file. The annotations API is probed with its query before enabling Save annotations. Missing/deployed-but-refused API access keeps saving disabled with an explanation and availability retry.

Save annotations pauses playback, decodes the same original using a separate video, samples every 200 ms, and writes separate `skarl.annotations.v1` hands and objects files with the witnessed source SHA-256, actual model/runtime, dimensions, sample FPS, advisory flag and normalized geometry. Objects files also carry the paired hand keypoints and name both models, so the backend can recompute cup overlap from uploaded geometry. Summaries include detected frames, maximum hand count, object detection counts and paired cup overlap frames. Summary duration is the last sampled timestamp, not the full clip duration; the backend recomputes summaries from the file. Each successful run appears in the refreshed list. Independent files can partially succeed; failure text tells the operator to refresh before retrying. Downloaded runs are validated and bound to both submission ID and current source hash before display. Saved masks from compatible clients can display region bounds/polygons; this UI does not persist masks.

The deployment owner must deploy the annotations backend. No `convex dev` or `convex deploy` was run for this work. No live annotation upload, private-clip inference, task accuracy, acceptance or chain transaction is claimed from the synthetic tests.

## Verification

Web tests exercise geometric overlap, source binding, malformed downloaded geometry, sampled-frame windows, scaffold jury handling, timestamp validation, sensor units/gaps and media proxy restrictions. Actual headless Chrome model smoke tests used synthetic imagery: hands and objects initialized and ran, repeated/backward media timestamps were accepted, and SAM2.1 segmented a circle using both WebGPU and WASM. Those are runtime checks, not an accuracy evaluation.
