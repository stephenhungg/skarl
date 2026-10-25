# Buyer datasets

Source implementation, pending deployment by the deployment owner. Tests use
synthetic storage, reports, and ledger records; they do not demonstrate live
inference, sensor synchronization, downloads, or chain transactions.

Skarl collects task-targeted human demonstration video. The output is licensed
video plus evidence and conversion metadata. It is **not robot teleoperation**:
no robot actions, joint states, depth, camera poses, rewards, or
discounts are recorded. A supported task criterion is a verification finding,
not a robot control label. No action fields are inferred from narration.

## Access and formats

`datasets.forOrder({demoIdentity, orderId, refreshKey?})` returns
`skarl.dataset.v1`. The order's buyer and an organization controller may read
licensed published samples. Review queues, verification-only/evaluation uploads,
missing consent, corrupt bindings, and quarantined media are excluded. Explicit
human acceptance can publish a sample whose machine recommendation remains
`needs_review`; its quality score keeps that limitation visible.

The HTTP endpoint uses `x-skarl-demo-identity: buyer` or `controller`. These are
impersonable demo selectors, not production authentication.

| Request | Output |
| --- | --- |
| `/api/orders/ORDER_ID/dataset` | Versioned JSON manifest with samples |
| `?format=jsonl` | One complete sample per line; empty dataset produces an empty body |
| `?format=lerobot` | `skarl.lerobot-v2-manifest.v1`, LeRobot-v2-style info, task and episode metadata |
| `?format=rlds-json` | `skarl.rlds-json.v1`, RLDS-style episode and step conversion metadata |

All formats retain each sample's quality breakdown, usable bounds, consent
license, source hash, decision basis, duplicate status, optional attestation and
reconciled payout evidence. Monetary values remain decimal integer micro-USDC
strings. Environment and variant labels are explicitly contributor self-reports.
Each sample also includes `provenance: skarl.provenance.v1`, using the delivered
analysis snapshot for liveness, privacy heuristics and EAS references. Consent
and revocation status remain current; see [Consent and sample provenance](provenance.md).

### Derived annotations

Each sample includes an `annotations` array (empty when no runs are stored).
Every entry carries `kind` (`hands`, `objects`, or `masks`), `model` with its
name, version and browser runtime, a server-recomputed `summary`, a private
annotation JSON `url`, and explicit `derived: true` and `advisory: true` flags.
The JSON file uses `skarl.annotations.v1`; hand pose keypoints, object boxes and
mask outlines are browser-derived model estimates, not recorded robot states or
human-verified labels. These outputs cannot change verdicts, acceptance,
payables or quality scores. Model names and versions are client-declared
provenance, not server-attested inference. All four export formats retain the
same annotation metadata. LeRobot and RLDS also read the latest saved, validated
`hands` run into an explicitly advisory action proxy. Objects and masks remain
annotation references; they are not robot action labels.

`provenance.derivedAnnotations` lists the runs with model, summary, timestamp and
`basis: "client_computed"`, without creator identities or download grants.
Annotation URLs are private storage grants; refresh the authorized export for a
current URL and do not publish these bearer credentials. Already issued storage
URLs and downloaded annotation files cannot be recalled by consent revocation.
Server-side batch annotation is a roadmap item, not an implemented processing
path. See [Derived annotations](dashboard-api.md#derived-annotations-hands-objects-masks)
for upload limits and access checks.

### LeRobot metadata

The manifest includes `info.codebase_version: "v2.1"`, `robot_type: "human_video"`,
episode/task totals, `fps`, and `features`. Each episode includes
`episode_index`, `task_index`, `language_instruction` from the frozen task prompt
plus the delivered narration transcript (separated by a blank line),
`success: true` from stored acceptance, `length` in video frames, and a private
reference under `videos["observation.images.video"]`.

Verified video FPS, dimensions and frame counts are not currently persisted.
Consequently `fps`, `length`, video shape and nonempty dataset total frame count
are null. Optional `client_reported_fps` is separate and does not establish a
verified FPS or frame count. Duration remains available in milliseconds.

When a raw sensor trace still exists, feature descriptors reflect only its
listed channels:

| Raw channel | Feature | Units |
| --- | --- | --- |
| `accelerometer` | `observation.imu.accelerometer` | g, including gravity |
| `gyroscope` | `observation.imu.gyroscope` | rad/s |
| `deviceMotion` | `observation.imu.linear_acceleration` | m/s², excluding gravity |
| `gravity` | `observation.imu.gravity` | m/s² |
| `attitude` | `observation.orientation` | alpha/beta/gamma, radians |
| `magnetometer` | `observation.imu.magnetometer` | µT |

The global feature set is the union; each episode's `sensor_features` identifies
its available channels. These channel descriptors describe raw asynchronous
readings. V2 traces additionally materialize `frames[].observation.state` using
the explicit sync offset and client-reported native file FPS; see the field map
below. V1 traces remain valid and summarized, with no fabricated alignment.
Raw trace storage IDs and download URLs remain private (`rawTraceDownload` and
feature `download_url` are null).

`compatibility.directly_loadable` is false. A converter must download authorized
video, verify FPS/dimensions/frame counts, decode actual frame timestamps, and
write Parquet and local videos before loading a `LeRobotDataset`. The nominal
grid is useful conversion input, not proof of exact frame PTS. The reference
layout uses `meta/info.json`, episode/task metadata, per-frame Parquet, and videos;
see the [LeRobot v0.3.3 dataset utilities](https://github.com/huggingface/lerobot/blob/v0.3.3/src/lerobot/datasets/utils.py).

### RLDS metadata

Each episode has a stable `episode_id`, indexes, combined `language_instruction`,
video reference, accepted `success`, and the same source/evidence/quality metadata.
When V2 sync and file FPS are available, `steps` contains nominal timestamped
video references plus resampled state, with `is_first`/`is_last` flags.
`steps_status: "temporal_references_not_decoded"` makes clear that these steps
contain references to video time, not decoded pixels. Missing sync/FPS or V1
traces produce `steps: []`, `steps_status: "not_materialized"`, unless a saved
hand run and known file FPS support a hand-only temporal grid. Such a grid has
no IMU state columns.
No terminal signals, environment rewards, discounts or robot controls are emitted.

`compatibility.directly_loadable` is false: this JSON is not TFDS. Decode the
video and verify actual frame timestamps before training. Success means accepted
delivery, not an environment reward or terminal signal. See the
[RLDS dataset format](https://github.com/google-research/rlds#dataset-format).

### V2 robotics field map and alignment

The training formats call `datasets.trainingInputs` once per licensed episode.
That action reads bounded private trace and latest hand-annotation JSON, validates
both contracts, checks annotation source/submission bindings, and repeats current
publication/consent authorization after storage I/O. Invalid or missing bytes
produce no state/action proxy; they never become zeros or detections. No new
secret or database is needed. Raw hydration inputs are excluded from exports.

| Episode field | Meaning and missing-data behavior |
| --- | --- |
| `language_instruction` | Frozen task prompt, then delivered narration text; narration remains untrusted language data |
| `segments` | Optional contributor-tapped rubric sub-task boundaries `{label,startMs,endMs}` in video milliseconds; `[]` without taps |
| `context` | Self-reported `mount`, `dominantHand`, `environment`, `lighting`; null for old captures |
| `camera` | Client device metadata: model/OS/app, back facing, requested 720p/codec, measured file `resolution`/`fps`/`videoDurationMs` when available, actual codec null when unavailable, zoom, `metadataSource` |
| `camera.intrinsics` | Model-FOV estimate `{estimated:true,width,height,fx,fy,cx,cy,horizontalFovDegrees,source}` in pixel coordinates; null for unknown models/dimensions; no calibration claim |
| `sync` | `videoStartOffsetMs`, `videoStopOffsetMs`, `source`, `accuracy`; Expo progress synchronization is explicitly `approximate`, never hardware/frame-accurate |
| `grid` | FPS and its provenance (`client_reported_file_metadata` or verified server metadata if later supplied), nearest-sample rule and 100 ms maximum gap; `native_frame_timestamps:false` |
| `state_names`, `state_units` | Ordered channel/axis names and units for flattened state; absent channels are omitted |
| LeRobot `frames` | `frame_index`, `timestamp` in video seconds, `observation.state`; nominal file-FPS grid, not decoded video |
| RLDS `steps[].observation.state` | Same resampled vector, paired with `observation.video.{url,timestamp}`; video is an external temporal reference |
| `action_proxy` | Latest validated saved hand run: model/version/runtime, `advisory:true`, `derived:true`, `robot_control:false`, normalized-image coordinates and original timestamped `keyframes`; null without saved hands |
| Frame/step `action` | Advisory hand keypoints nearest video time within half an annotation period (at most 250 ms); null outside coverage; empty hands means an actual saved no-detection frame |

For video frame time `t_ms`, the resampler looks up trace time
`t_ms + videoStartOffsetMs`. It chooses each channel's nearest actual callback
sample within 100 ms, preserving the original axis values; it does not synthesize
missing channels, extrapolate through longer gaps, or extend past the recorded
stop. Missing values are null. V1 invocation-relative traces have no trustworthy
video offset, so their raw feature descriptors remain available but no state grid
is generated. FPS is never inferred from the IMU or annotation sample rate.
A nominal grid from native file-average FPS still needs re-alignment to decoded
frame PTS for variable-frame-rate video and careful robot-learning use.

Camera dimensions/intrinsics from iOS use encoded track pixel axes, while browser
hand points use displayed-video coordinates. Apply the video's display rotation
before combining them; the estimate supplies no calibrated camera-to-hand transform.

## Usable segment and quality

`usableStartMs` and `usableEndMs` are derived from valid timestamped evidence for
unique **supported frozen-rubric findings**: earliest start minus 500 ms, latest
end plus 500 ms, clamped to stored duration. Unknown rubric IDs, contradicted or
unobservable findings, duplicate findings, and invalid intervals earn no bounds.
Without supported timestamped evidence both fields are null. This is a bounding
window, not a guarantee that every intervening frame contains useful action.
The original video is not trimmed; use the offsets during conversion.

The `method` is `skarl.quality.heuristic.v1`. `components` contains each
component's `score`, `maxScore`, `status`, and textual `evidence`:

| Component | Points | Witness |
| --- | --- | --- |
| `juryAgreement` | 0–25 | Agreement across at least two distinct completed model reports bound to the same submission, task, source and pipeline |
| `allCriteriaSupported` | 0 or 25 | Every rubric criterion uniquely supported with valid timed evidence |
| `duplicateClear` | 0 or 20 | Stored heuristic check is clear with no matches; not proof of uniqueness |
| `livenessPassed` | 0 or 15 | Stored challenge matches timestamped transcript; not identity verification |
| `sensorSteadiness` | 0–5 | Rounded 5 × client-reported steady-gyro ratio, when raw trace remains available |
| `attestationPresent` | 0 or 10 | Confirmed EAS commitment matching source, report, rubric, pipeline, recommendation and license |

Missing witnesses receive zero points. Optional missing sensors receive zero,
with no weight redistribution. Jury and sensor fractional contributions are
rounded to the nearest integer. `rawQualityScore` is the component sum.
`qualityScore` is capped at 49 when the submission is not accepted, completed
accepting inference is unavailable, duplicate evidence is unclear, any criterion
lacks supported evidence, or a witnessed jury disagrees. `scoreCap` and
`capReasons` explain that cap. Human acceptance does not erase these limits.
An EAS commitment establishes what was committed, not that the report is true.

This score is a deterministic ranking heuristic, not calibrated model accuracy,
acceptance authority, licensing authority, or payment authority. A score of 100
does not establish that the video improves a buyer's robot model.

`datasets.sampleQuality({demoIdentity, submissionId})` is a media-free companion
to the witness receipt. The owning contributor, order buyer, or controller can
read it. Accepted published samples use the delivery's analysis snapshot;
otherwise it uses the current bound analysis. `evidenceBasis` and `analysisId`
identify that choice. Advisory detector annotations do not contribute to this
quality score.

## Diversity quotas

Orders may carry optional `diversity: {maxPerContributor?, maxPerEnvironment?,
requiredVariants?}`. Submissions may declare optional `environment` and `variant`.
All existing records and callers remain valid without these fields.

Caps apply to accepted samples within an order. An environment cap requires a
candidate environment tag. `requiredVariants` means each requested label must
occur at least once by fulfillment: acceptance reserves one remaining slot for
each still-uncovered label. It is not an allowlist; extra labels can be accepted
while sufficient slots remain. Labels are trimmed and case-sensitive, 1–120
characters with no control characters. Quota caps are positive safe integers;
required labels must be unique, at most 100, and no more than the requested
quantity. Terms bind the normalized diversity configuration.

The same atomic acceptance path is used for machine-supported and human-reviewed
delivery. A violating candidate returns `{ok:false, code:"diversity_quota_exceeded"}`
and a durable `acceptance_refused` audit with the quota component. It creates no
delivery, payable, or journal. Acceptance replays return the prior result;
concurrent acceptance cannot consume the same remaining diversity capacity.

`orders.diversityCoverage({demoIdentity, orderId})` reports accepted counts,
remaining quantity, contributor/environment/variant buckets, untagged counts,
required-label coverage, and missing variants. Contributor bucket keys are
order-scoped SHA-256 values, not raw identity tokens. Tags describe declared
coverage and do not prove visual diversity, different people or environments.

## Media and deployment

Video URLs are signed five-minute buyer grants. Export again to refresh them;
the serving proxy rechecks current ownership, consent and delivery bindings.
Requested or completed consent revocation blocks fresh manifest entries and
previously issued grants. It does not recall downloaded copies or erase earned
payables and historical evidence.
All responses are private and uncached. Never publish these bearer credentials.

Deploy the optional Convex sensor V2 schema fields, `datasets.trainingInputs`
and its internal authorization query, then the updated web route.
No data migration, backfill, new secrets, or inference rerun is required.
The existing matching `SKARL_PAYMENTS_SERVICE_SECRET` is required for video grants.
See [Dashboard API](dashboard-api.md#buyer-dataset-export) for query details.
