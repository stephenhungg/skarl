# Mobile capture and motion evidence

Skarl's standalone [Expo Go app](../apps/mobile/README.md) collects consented
10–30 second portrait task videos with narration and a synchronized IMU trace.
This is a **Base Sepolia testnet demo** using the existing impersonable contributor
identity. It creates ordinary licensed demo contributions, never `verificationOnly`
submissions. No wallet key, location data or new database is introduced.

## Why sensors

Embodied-AI data buyers can use synchronized video, audio and inertial signals
to study camera motion alongside visible actions. This thin slice preserves the
raw channels and exposes simple plotting summaries, without claiming that phone
motion measures hand or object motion. An accelerometer measures the camera
device, not the cup.

Motion can contribute to an anti-recapture investigation, but it is **not hardware
attested** and an uploaded trace can be fabricated. The current red-cup task asks
for a **fixed camera**, so a still IMU during pickup or placement is expected. We
therefore do not issue a “possible screen recapture” warning or force review from
that condition. Sensors can never recommend acceptance or authorize payment.

## Capture contract

The app requests 20 ms updates (~50 Hz) from available Accelerometer, Gyroscope,
and DeviceMotion channels. Capture starts with the recording call and stops on
completion/interruption. Only actual sampled channels appear in `sensors`;
permission denial or unavailable hardware produces `sensors: []`, `samples: []`.
No location permission is requested, and the server rejects unknown JSON fields.

- `accelerometer`: x/y/z in **g**, including gravity; stationary magnitude ≈1 g.
- `gyroscope`: x/y/z in **radians/second**.
- `deviceMotion`: linear acceleration x/y/z in **m/s²**, excluding gravity.
- `timestampMs`: monotonic app callback time relative to the recording invocation,
  using `performance.now()`. This is approximate synchronization, not native
  hardware timestamps or frame-accurate alignment. OS batching/dropped events
  can lower the effective rate. Native recording progress gates the 10-second stop.
- Metadata includes model, OS/version, app version, back camera, requested 720p
  quality and ISO `recordedAt`. Actual resolution/fps are optional; the app does
  not invent measurements that the camera API does not return.

JSON is uncompressed and capped at 2 MiB. It is stored privately in Convex;
only bounded metadata and summaries live in the submission document. The trace
schema is [sensorTrace.ts](../convex/lib/sensorTrace.ts), with Convex validators
in [sensorTraceValidators.ts](../convex/sensorTraceValidators.ts). This is a
separate evidence attachment; the canonical verification report JSON Schema and
Python report model are unchanged.

## Upload and trust boundary

The client gets `submissions:generateUploadUrl`, POSTs the video and sensor JSON
using separate URLs, then calls `submissions:create` with the stable request UUID,
`demoIdentity: "contributor"` and `consentAcknowledged: true`. It calls
`sensorTraces:attachSensorTrace` with the created submission and uploaded trace.
The action validates stored bytes and derives the metadata/summary server-side.
A following internal mutation rechecks contributor ownership and tenant/consent
before attaching. Attachments are immutable, replay-safe and cannot be reused
for another submission; accepted/rejected contributions cannot gain new evidence.

The two steps are not atomic: video analysis can begin before sensor attachment.
The app labels that intermediate state and retries the attachment. Sensors are
optional advisory evidence, so this never changes the existing acceptance gate.
If a controller decides before attachment, the server freezes evidence and
rejects the late attachment. That terminal error requires operator review; it
must not cause a second video submission.

Live `submissions:getReport` powers the status and timestamped criteria. The
owner/controller-only `media:submissionEvidence` returns `sensorTrace` or null.
Its signed-by-possession storage URL is private bearer access: do not cache or
publish it. Demo identities remain impersonable; these are demo role boundaries,
not production authentication.

## Motion summary for the dashboard

See the [exact API handoff](dashboard-api.md#mobile-sensor-evidence). RMS magnitude
is computed over each channel's samples, both globally and in 250 ms bins.
Missing channels are `null`, not zero. Active bins have any sample satisfying:
`abs(accelMagnitudeG - 1) > 0.08`, gyro magnitude >0.15 rad/s, or linear
acceleration >0.8 m/s². Contiguous active bins merge into intervals. These are
simple uncalibrated plotting heuristics, not a classifier or provenance proof.

## Verification and deployment

Local strict TypeScript and the iOS Metro/Hermes export are build checks. Synthetic
backend tests cover content validation, rate/size caps, monotonic timestamps,
ownership, replay/immutability and non-authority over acceptance/payments. Mobile
retry tests exercise loss of a create/attach response. None establish a physical
iPhone capture, live model inference or payment.

**A Convex deployment from main is required** for the optional submission fields,
index and sensor action. The mobile work does not deploy Convex. The operator
should deploy, then follow the [phone smoke test](../apps/mobile/README.md#phone-smoke-test).

## Visual alignment

Native tokens in [theme.ts](../apps/mobile/theme.ts) match the landing page's
paper/mist/haze/slate palette, with lime reserved for live or accepted evidence,
recording and selection. The app uses the actual Montreal and Fono fonts,
converted from the web WOFF2s to OTF with FontTools, and the same seven-cell logo.
Body copy, task cards, 18px gutters and 12px card corners mirror the contributor
page. The native stepper and evidence lanes use that same visual language.
Motion uses `Easing.bezier(.43, .42, .37, .97)` and respects Reduce Motion.

These screenshots compare the **real web-exported Expo UI** against
[the deployed contributor page](https://skarl.vercel.app/contribute), both at
390 × 844 CSS pixels. Both loaded the live demo rubric; no submission or camera
capture was fabricated for the screenshots. The app adds explicit testnet and
sensor labels, and displays the exact 1.875 test-USDC rate in mono (the web rounds
its display). A browser layout render does not establish native camera behavior.

| Deployed web reference | Expo UI (web export) |
| --- | --- |
| ![Web contributor page](mobile/web-contribute-390.png) | ![Expo contributor page](mobile/expo-contribute-390.png) |

[Side-by-side comparison](mobile/comparison-390.png) ·
[Consent and recording screen](mobile/expo-consent-record-390.png).
