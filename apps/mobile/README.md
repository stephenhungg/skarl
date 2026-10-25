# Skarl mobile

A standalone Expo Go iPhone app for real, consented demo contributions: portrait
back-camera video with narration, synchronized device sensors, private uploads,
and live analysis/review status. **Base Sepolia testnet, test USDC.** Google is
the only real sign-in; a labeled, unsigned demo contributor is also available.
Payout signing is not part of this app.

## Run on your iPhone

Install **Expo Go 58.0.5 or newer** from the [App Store](https://apps.apple.com/us/app/expo-go/id982107779). The October 22 store release added SDK 58 support; the original SDK release post predates that availability. This project uses **Expo SDK
58** (`expo 58.0.19`), React Native 0.88 and React 19.3, checked against
[Expo Go](https://expo.dev/go), the [SDK 58 release](https://expo.dev/changelog/sdk-58), and the published SDK 58 template on October 25, 2026.

From the repository root:

```sh
cd apps/mobile
bun install --frozen-lockfile
cp .env.example .env
bunx expo start --go --lan
```

Keep your Mac and iPhone on the same Wi-Fi. Scan the terminal QR code with the
iPhone Camera and open it in Expo Go. The app does not require Xcode, EAS, an App
Store submission or a simulator. If the Wi-Fi blocks device-to-device traffic,
use a personal hotspot that permits it. Allow Local Network access for Expo Go.

`.env` sets the public deployment URL:

```dotenv
EXPO_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud
```

Restart Expo after changing it. No private API key belongs in an `EXPO_PUBLIC_`
variable. **The operator must deploy the sensor backend from main before sensor
attachment works.** This work does not deploy Convex.

## Google sign-in

The operator must configure Google OAuth and deploy the backend before real
sign-in works. Follow [authentication setup](../../docs/auth.md): use a Google
OAuth client of type **Web application**, with the exact redirect URI
`https://keen-marmot-986.convex.site/api/auth/callback/google`. Google client
credentials stay on Convex; no secret belongs in this app.

Choose “Continue with Google”, complete the browser flow, then claim contributor
access for your own account. Profile signs out of Convex Auth. Tokens and the
OAuth verifier use `expo-secure-store`; AsyncStorage is only for the demo choice
and upload drafts. The separate demo button continues unsigned and remains
subject to `SKARL_DEMO_IDENTITIES` on the backend.

Expo Go uses the URL returned by
`makeRedirectUri({ scheme: "skarl", path: "auth" })`, typically
`exp://<metro-host>:8081/--/auth`. Keep the same Metro session reachable from the
phone. `skarl://auth` applies when running an app that registers the `skarl`
scheme; setting it in `app.json` does not add that scheme to Expo Go. Do not add
these app-return URLs to Google's authorized redirect URIs: Google returns to
the HTTPS Convex callback, then Convex redirects back to the app.

With real credentials on a physical iPhone, test successful sign-in, browser
cancellation, relaunch/session restoration, contributor onboarding, and sign-out.
Confirm a signed-in account sees only its own contributions even when demo mode
is enabled. These live OAuth/device checks are not established by local tests
or an iOS export.

## Phone smoke test

1. Read the live task and all consent terms, including sensor sharing. The camera
   stays off until consent. Enable camera/mic and allow Motion & Fitness if asked.
2. Keep the phone fixed and follow the selected task’s rubric. Record its
   requested objects, destination and ordered steps while narrating; only consenting
   participants may be visible/audible. Stop after 10 seconds; native recording
   stops at 30 seconds or the 24 MiB safety cap.
3. Review video/audio and the sensor sample count. Submit only when satisfied.
   The original remains private; this is a licensed demo contribution, **not** a
   verification-only evaluation upload.
4. Observe queued → analysing → needs_review (or a later human decision), with
   timestamped criterion evidence. Acceptance does not mean payout confirmed.
5. For buyer evidence, query `media:submissionEvidence`; `sensorTrace` includes
   the private JSON URL, server-computed RMS values and 250 ms chart bins.
6. Test denial of motion permission, background interruption during recording,
   and an upload interrupted by network loss. The app labels absent sensors,
   discards interrupted recordings, and resumes the same submission after retry
   or relaunch. Do not clear Expo Go app data while a contribution is pending.
7. In a separate test take, hold the phone still, briefly shake it, then rotate
   it continuously for over half a second: the lime pill should change from
   “Steady” to “Hold still” only for sustained movement. Tilt the portrait horizon
   past 15° to see “Level the phone”; aiming down at the cups alone should not
   trigger it. Stop/retake and verify guidance resets. There should be no haptics.
8. After the backend deploy, inspect a real uploaded trace for `attitude`
   (x/y/z = alpha/beta/gamma radians) and `gravity` (m/s²), alongside the original
   three channels when hardware provides them. Confirm `meanTiltDegrees` and
   `steadinessRatio` in the server summary. Permission denial must not show
   “Steady” or invent samples. These checks require a physical phone in Expo Go;
   local fixture tests and exports do not verify native sensor axes or timing.

The local draft and video remain in Expo Go's app storage until “Discard and
retake” or “Record another contribution.” Upload stages persist storage IDs and
the request UUID. A lost create response must be retried with the same IDs;
the app prevents discarding an unresolved creation. A lost storage POST response
can leave an unreferenced private upload; it cannot create a duplicate submission.

## Checks

```sh
bunx tsc --noEmit
bun test
EXPO_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud CI=1 bunx expo export --platform ios
EXPO_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud CI=1 bunx expo export --platform web
```

The project uses Bun and its own lockfile and dependencies. It is explicitly
excluded from `pnpm-workspace.yaml`; root checks and the Vercel web build do not
compile the mobile app. Metro resolves native dependencies from this project.
Function references use explicit Convex names and local response types, avoiding
backend imports into Metro.

Local export/typecheck are build checks, **not proof of physical iPhone sensor,
mic or upload behavior**. A human must complete the phone smoke test after the
operator's Convex deployment. See [mobile design and limits](../../docs/mobile.md).

## Visual alignment

`theme.ts` mirrors the web RGB tokens and typography roles. Native components
mirror the Skarl mark/wordmark, status pills, task cards, consent, buttons and
video/audio evidence lanes. The record → upload → verify stepper is a native
adaptation; no `apps/web/components/stepper.tsx` exists in the source snapshot.
Animations use the web settle curve and honor Reduce Motion.

The bundled Montreal Book/Regular/Medium and Fono OTFs are decompressed from the
existing web WOFF2 assets with FontTools (`TTFont`, `flavor = None`), preserving
the existing font data/names. They load at runtime with `expo-font` in Expo Go.
See the [390px screenshots and comparison](../../docs/mobile.md#visual-alignment).
The web export is for layout inspection; video/IMU capture is an iPhone flow.

## Robot-data capture v2 device checklist

After the operator deploys the Convex changes from main, use a physical iPhone
in Expo Go; fixture tests and Metro export do not prove recording synchronization.

1. Before filming, confirm Mount, Hand, Environment and Lighting. Change them,
   retake, and relaunch: the choices should persist. Confirm the recorded context
   appears in the submission report and both dataset episode formats.
2. Record a consenting visible action with a distinct phone movement and spoken
   cue. Inspect v2 JSON: `videoStartOffsetMs` should reflect recording startup,
   `videoStopOffsetMs` should match start plus the file duration (bounded by the
   trace clock), and `clock` should be `js-callback-performance-now`.
   Compare the cue and sensor peak on replay to estimate real timing error.
   **This is approximate synchronization**, derived from Expo's native duration
   progress callbacks; Expo Go exposes no native camera host/frame timestamps.
   Do not label it frame accurate. Repeat while the phone is busy and report the
   observed error before using it for time-sensitive training.
3. Tap the large **Next step** button when moving to each rubric action. Confirm
   the current label advances and saved segments share video-relative boundaries.
   Retake without tapping: recording/upload should work and `segments` should be
   empty. A haptic is requested on taps; iOS may suppress it while the camera is
   active, so the visible label is the reliable confirmation.
4. Inspect recorded metadata: actual encoded track resolution, nominal FPS and duration
   from `expo-video` when available; requested 720p/AVC remain distinct from
   measured metadata. Codec uses the track’s reported media subtype (for example,
   `video/avc1`); it is null when unavailable.
   Zoom is zero; the app requests the standard wide lens with stabilization off.
   Known iPhone 14/15 models should have `intrinsics.estimated: true`; unknown
   models and failed metadata inspection must have null intrinsics. The lookup
   uses Apple's main-lens full-frame-equivalent focal lengths for
   [iPhone 14](https://support.apple.com/en-us/111850),
   [iPhone 15](https://support.apple.com/en-us/111831) and
   [iPhone 15 Pro](https://support.apple.com/en-us/111829). It ignores video crop,
   distortion, file display rotation and focus changes; it is a pinhole estimate
   in the encoded track dimensions, not calibration. Apply the video display
   transform before comparing it to decoded/display-oriented hand coordinates.
5. Inspect magnetometer x/y/z in microteslas when available. Turn the phone away
   from metal and compare changes; these are raw magnetic readings, not a
   calibrated compass heading. Deny motion permission and verify no fabricated
   channels, vectors or zero heading: all absent channels belong in
   `unavailableSensors`. Confirm missing recording progress yields null sync
   offsets and no invented segments.
6. Export a licensed accepted take as LeRobot and RLDS. Check that frame time zero
   uses sensor time `videoStartOffsetMs`, sub-task boundaries follow your taps,
   camera metadata accompanies the episode, and any saved hand keypoints are
   clearly marked advisory action proxies. Compare a legacy v1 sample: it must
   still summarize, with unavailable frame alignment shown honestly.
7. Background the app while filming; discard the interrupted take. Then test a
   network-loss upload/relaunch and verify the same submission resumes with its
   original v2 trace, context and segments.

ARKit poses, LiDAR/depth and native camera/sensor host-clock synchronization are
roadmap items requiring a custom native build; they are outside this Expo Go app.
