# Skarl mobile

A standalone Expo Go iPhone app for real, consented demo contributions: portrait
back-camera video with narration, synchronized device sensors, private uploads,
and live analysis/review status. **Base Sepolia testnet, test USDC, impersonable
demo identities.** No production authentication or payout signing in this app.

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

## Phone smoke test

1. Read the live task and all consent terms, including sensor sharing. The camera
   stays off until consent. Enable camera/mic and allow Motion & Fitness if asked.
2. Keep the phone fixed, as the live red-cup rubric asks. Record yourself picking
   up the red cup and placing it on the coaster while narrating; only consenting
   participants may be visible/audible. Stop after 10 seconds; native recording
   stops at 30 seconds or the 24 MiB safety cap.
3. Review video/audio and the sensor sample count. Submit only when satisfied.
   The original remains private; this is a licensed demo contribution, **not** a
   verification-only evaluation upload.
4. Observe queued → analysing → needs_review (or a later human decision), with
   timestamped criterion evidence. Acceptance does not mean payout confirmed.
5. For controller evidence, query `media:submissionEvidence`; `sensorTrace` includes
   the private JSON URL, server-computed RMS values and 250 ms chart bins.
6. Test denial of motion permission, background interruption during recording,
   and an upload interrupted by network loss. The app labels absent sensors,
   discards interrupted recordings, and resumes the same submission after retry
   or relaunch. Do not clear Expo Go app data while a contribution is pending.

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
