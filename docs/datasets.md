# Buyer datasets

Source implementation, pending deployment by the deployment owner. Tests use
synthetic storage, reports, and ledger records; they do not demonstrate live
inference, sensor synchronization, downloads, or chain transactions.

Skarl collects task-targeted human demonstration video. The output is licensed
video plus evidence and conversion metadata. It is **not robot teleoperation**:
no robot actions, joint states, hand poses, depth, camera poses, rewards, or
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

### LeRobot metadata

The manifest includes `info.codebase_version: "v2.1"`, `robot_type: "human_video"`,
episode/task totals, `fps`, and `features`. Each episode includes
`episode_index`, `task_index`, `language_instruction` from the frozen task prompt,
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

The global feature set is the union; each episode's `sensor_features` identifies
its available channels. Sensors are asynchronous client-reported phone readings,
not robot states or calibrated poses. No frame alignment is claimed. The export
does not expose raw trace storage IDs or download URLs (`rawTraceDownload` and
feature `download_url` are null). Access to the raw sensor bytes requires a
separate authorized integration; descriptors are not materialized training columns.

`compatibility.directly_loadable` is false. A converter must download authorized
video, verify FPS/dimensions/frame counts, produce per-frame Parquet and local
videos, and separately obtain/align sensor traces if needed. The manifest does
not pretend to be a complete `LeRobotDataset` archive. The reference layout uses
`meta/info.json`, episode/task metadata, per-frame Parquet, and videos; see the
[LeRobot v0.3.3 dataset utilities](https://github.com/huggingface/lerobot/blob/v0.3.3/src/lerobot/datasets/utils.py).

### RLDS metadata

Each episode has a stable `episode_id`, indexes, `language_instruction`, video
reference, accepted `success`, and the same source/evidence/quality metadata.
`steps: []` and `steps_status: "not_materialized"` explicitly record that frame
steps have not been decoded. Top-level `step_metadata` describes the observation
key and required `is_first`/`is_last` flags for a converter. No fake step
observations, terminal signals, rewards, discounts or actions are emitted.

`compatibility.directly_loadable` is false: this is JSON conversion metadata,
not TFDS. Populate observation-only steps from decoded video before training.
Success means accepted delivery; it is not an environment reward or terminal
signal. RLDS requires consistent step structure and permits optional actions,
rewards and discounts; see the [RLDS dataset format](https://github.com/google-research/rlds#dataset-format).

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
identify that choice. The witness receipt implementation is unchanged.

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
All responses are private and uncached. Never publish these bearer credentials.

Deploy the optional Convex schema fields and functions, then the web route.
No data migration, backfill, new secrets, or inference rerun is required.
The existing matching `SKARL_PAYMENTS_SERVICE_SECRET` is required for video grants.
See [Dashboard API](dashboard-api.md#buyer-dataset-export) for query details.
