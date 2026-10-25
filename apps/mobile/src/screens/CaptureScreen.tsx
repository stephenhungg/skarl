import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useConvex, useQuery } from 'convex/react';
import { enter, timing } from '../components/motion';
import Animated, { FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors as c, fonts as f } from '../../theme';
import { api, identity, type LivenessChallenge } from '../api';
import { availableSensors, startTrace, type Sensor } from '../sensors';
import { createMotionCoach, type MotionCoaching } from '../motionCoach';
import { clearDraft, saveDraft, submitDraft, type Draft } from '../upload';
import { useLiveTask } from '../data';
import { useSession } from '../session';
import { PressableScale } from '../components/PressableScale';
import { Button, StatusPill } from '../components/Primitives';
import { Sheet } from '../components/Sheet';
import { CaptureIcon, CheckIcon, CloseIcon } from '../components/Icons';
import type { RootProps } from '../navigation';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const MIN_MS = 10_000, MAX_MS = 30_000;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const haptic = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); };

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="cover" />;
}

/** Record button with a progress ring; a tick marks the 10 second minimum. */
function RecordButton({ recording, elapsed, disabled, onPress }: { recording: boolean; elapsed: number; disabled: boolean; onPress(): void }) {
  const size = 84, stroke = 4, r = (size - stroke) / 2, length = 2 * Math.PI * r;
  const progress = useSharedValue(0);
  useEffect(() => { progress.value = withTiming(recording ? Math.min(1, elapsed / MAX_MS) : 0, { duration: 120 }); }, [elapsed, recording, progress]);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  const inner = useAnimatedStyle(() => ({
    width: withTiming(recording ? 30 : 64, timing), height: withTiming(recording ? 30 : 64, timing),
    borderRadius: withTiming(recording ? 8 : 32, timing),
  }), [recording]);
  const tick = (MIN_MS / MAX_MS) * 2 * Math.PI - Math.PI / 2;
  return <PressableScale accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : 'Record'} disabled={disabled} onPress={onPress}
    style={[s.record, disabled && { opacity: 0.45 }]} scale={0.92}>
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.28)" strokeWidth={stroke} fill="none" />
      <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={c.accent} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${length} ${length}`} animatedProps={ring} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {recording && <Circle cx={size / 2 + Math.cos(tick) * r} cy={size / 2 + Math.sin(tick) * r} r={3} fill={elapsed >= MIN_MS ? c.accent : c.paper} />}
    </Svg>
    <Animated.View style={[{ backgroundColor: recording ? c.paper : '#e5484d' }, inner]} />
  </PressableScale>;
}

function Blink() {
  const o = useSharedValue(1);
  useEffect(() => { o.value = withRepeat(withTiming(0.25, { duration: 600 }), -1, true); }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[s.redDot, style]} />;
}

function LiveStatus({ id }: { id: string }) {
  const result = useQuery(api.report, { ...identity, submissionId: id });
  return result ? <StatusPill status={result.status} /> : <ActivityIndicator color={c.slate500} />;
}

const STAGES: { key: keyof Draft; text: string }[] = [
  { key: 'videoStorageId', text: 'Video' }, { key: 'sensorStorageId', text: 'Motion' },
  { key: 'submissionId', text: 'Submission' }, { key: 'attached', text: 'Sensors linked' },
];

export function CaptureScreen({ navigation, route }: RootProps<'Capture'>) {
  const insets = useSafeAreaInsets();
  const convex = useConvex();
  const { context, task } = useLiveTask();
  const { draft, setDraft, restoreError } = useSession();
  const [cameraPermission, askCamera] = useCameraPermissions();
  const [micPermission, askMic] = useMicrophonePermissions();
  const consent = route.params?.consented === true || !!draft;
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [recording, setRecording] = useState(false);
  const [coaching, setCoaching] = useState<MotionCoaching>({ steady: null, tilted: null });
  const motionCoach = useRef(createMotionCoach());
  const motionStartedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const recordedDuration = useRef(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(restoreError);
  const camera = useRef<CameraView>(null);
  const trace = useRef<ReturnType<typeof startTrace> | null>(null);
  const captureBusy = useRef(false);
  const uploadBusy = useRef(false);
  const interrupted = useRef(false);
  const permitted = cameraPermission?.granted && micPermission?.granted;
  const closed = task?.closed;
  const done = !!draft && (!!draft.attached || !!draft.attachmentClosed);
  const sheetOpen = uploading || (!!draft && (!!draft.createAttempted || done));

  useEffect(() => {
    if (!recording) return;
    // Read at 10 Hz instead of rerendering for every sensor sample. The timer
    // also clears stale advice if native callbacks stop while the camera runs.
    const timer = setInterval(() => {
      const next = motionCoach.current.status(performance.now() - motionStartedAt.current);
      setCoaching(previous => previous.steady === next.steady && previous.tilted === next.tilted ? previous : next);
    }, 100);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && captureBusy.current) {
        interrupted.current = true;
        trace.current?.stop();
        camera.current?.stopRecording();
      }
      if (state !== 'active') { setEnabled(false); setReady(false); }
    });
    return () => { subscription.remove(); trace.current?.stop(); camera.current?.stopRecording(); };
  }, []);

  useEffect(() => {
    if (!enabled && (!draft?.livenessExpiresAt || draft.submissionId)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, draft?.livenessExpiresAt, draft?.submissionId]);

  async function refreshChallenge() {
    setBusy(true); setError(null); setChallenge(null);
    try {
      const issued = await convex.mutation(api.challenge, identity);
      setChallenge(issued); setNow(Date.now());
    } catch (error) { setError(`Could not get fresh words: ${message(error)}`); }
    finally { setBusy(false); }
  }

  async function enableCamera() {
    setBusy(true); setError(null); setChallenge(null);
    try {
      const cam = await askCamera();
      const mic = await askMic();
      if (!cam.granted || !mic.granted) throw new Error('Camera and microphone access needed. Enable both in Settings.');
      const available = await availableSensors().catch(() => [] as Sensor[]);
      const issued = await convex.mutation(api.challenge, identity);
      if (AppState.currentState !== 'active') throw new Error('Return to Skarl and turn on the camera again for fresh words.');
      setChallenge(issued); setNow(Date.now());
      setSensors(available); setReady(false); setEnabled(true);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function record() {
    if (!camera.current || !context || !ready || !consent || captureBusy.current || busy) return;
    // Leave time for a full take and upload. Never swap the words while filming.
    if (!challenge || challenge.expiresAt - Date.now() < 60_000) {
      await refreshChallenge();
      return;
    }
    const takeChallenge = challenge;
    captureBusy.current = true; interrupted.current = false; recordedDuration.current = 0; setError(null); setElapsed(0); setRecording(true);
    try {
      motionCoach.current = createMotionCoach();
      setCoaching({ steady: null, tilted: null });
      motionStartedAt.current = performance.now();
      trace.current = startTrace(sensors, sample => motionCoach.current.sample(sample));
      const result = await camera.current.recordAsync({ maxDuration: 30, maxFileSize: 24 * 1024 * 1024, codec: 'avc1', progressUpdateInterval: 0.1 });
      const data = trace.current.stop();
      if (interrupted.current) throw new Error('Recording was interrupted. Keep Skarl open and record a new take.');
      if (!result?.uri || recordedDuration.current < MIN_MS) throw new Error('Record at least 10 seconds.');
      const clientRequestId = Crypto.randomUUID();
      const extension = /\.mov(?:\?|$)/i.test(result.uri) ? 'mov' : 'mp4';
      const file = new File(Paths.document, `skarl-${clientRequestId}.${extension}`);
      new File(result.uri).copy(file);
      const next: Draft = { uri: file.uri, clientRequestId, orderId: context.orderId, trace: data,
        livenessChallengeId: takeChallenge.challengeId, livenessExpiresAt: takeChallenge.expiresAt };
      setDraft(next);
      await saveDraft(next);
    } catch (error) { setError(message(error)); }
    finally {
      trace.current?.stop(); trace.current = null; captureBusy.current = false; setRecording(false);
      // Even a failed or interrupted recording used this take's words. Reopen for a new challenge.
      setChallenge(null); setEnabled(false); setReady(false);
    }
  }

  async function submit() {
    if (!draft || !consent || uploadBusy.current) return;
    uploadBusy.current = true; setBusy(true); setUploading(true); setError(null);
    try { await submitDraft(convex, draft, (next, stage) => { setDraft(next); setProgress(stage); }); haptic(); }
    catch (error) { setError(message(error)); }
    finally { uploadBusy.current = false; setBusy(false); setUploading(false); }
  }

  async function retake() {
    if (draft?.createAttempted && !draft.attached && !draft.attachmentClosed) return;
    try {
      await clearDraft();
      if (draft) { const file = new File(draft.uri); if (file.exists) file.delete(); }
      setDraft(null); setError(null); setProgress(''); setElapsed(0); setEnabled(false); setReady(false); setChallenge(null);
      return true;
    } catch (error) { setError(message(error)); return false; }
  }

  async function finish(to: 'Profile' | 'Submission') {
    const id = draft?.submissionId;
    if (!(await retake())) return;
    if (to === 'Submission' && id) navigation.replace('Submission', { submissionId: id });
    else navigation.navigate('Tabs', { screen: 'Profile', params: { segment: 'Submissions' } });
  }

  const wordsFresh = !!challenge && challenge.expiresAt - now >= 60_000;
  const expired = !!draft?.livenessExpiresAt && !draft.submissionId && !draft.createAttempted && draft.livenessExpiresAt <= now;
  const seconds = (elapsed / 1000).toFixed(1);

  return <View style={[s.screen, { paddingTop: insets.top + 6, paddingBottom: Math.max(insets.bottom, 12) }]}>
    <StatusBar style="light" />
    <View style={s.top}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Close" disabled={recording || uploading} onPress={() => navigation.goBack()} style={s.iconButton}>
        <CloseIcon color={c.paper} />
      </PressableScale>
      <Text style={s.topTitle}>{draft ? 'Review' : 'Capture'}</Text>
      <View style={[s.iconButton, { backgroundColor: 'transparent' }]} />
    </View>

    <View style={s.frame}>
      {draft && !draft.submissionId ? <Preview uri={draft.uri} />
        : !draft && enabled && permitted && consent ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" mode="video" videoQuality="720p" videoBitrate={4_000_000} mute={false}
          onRecordingProgress={event => { recordedDuration.current = event.duration * 1000; setElapsed(recordedDuration.current); }}
          onCameraReady={() => setReady(true)} onMountError={event => { setReady(false); setError(event.message); }} />
          : <View style={s.off}>
            <CaptureIcon size={40} color={c.nightMuted} width={1.4} />
            {!consent && <Text style={s.offText}>Agree to task terms first</Text>}
          </View>}

      {!draft && enabled && <Animated.View entering={enter(0, 320)} pointerEvents="none" style={s.words}>
        <Text style={s.wordsLabel}>Say first</Text>
        <Text accessibilityLiveRegion="polite" style={s.wordsText}>{challenge?.words.join('  ·  ') ?? '...'}</Text>
        {!recording && <Text style={s.wordsMeta}>{!wordsFresh ? 'Words expiring, tap record for new ones' : `Fresh for ${Math.max(0, Math.ceil((challenge!.expiresAt - now) / 1000))} s`}</Text>}
      </Animated.View>}

      {recording && <Animated.View entering={FadeIn} exiting={FadeOut} pointerEvents="none" style={s.timer}>
        <Blink /><Text style={s.timerText}>{seconds} s</Text>
      </Animated.View>}

      {recording && <View pointerEvents="none" style={s.coach}>
        <Animated.View key={String(coaching.steady)} entering={FadeIn.duration(180)} style={[s.coachPill, coaching.steady === false && { backgroundColor: c.paper }]}>
          <Text style={[s.coachText, coaching.steady === false && { color: c.ink }]}>{coaching.steady === null ? 'Motion unavailable' : coaching.steady ? 'Steady' : 'Hold still'}</Text>
        </Animated.View>
        {coaching.tilted && <Animated.View entering={FadeIn.duration(180)} style={[s.coachPill, { backgroundColor: c.paper }]}><Text style={[s.coachText, { color: c.ink }]}>Level the phone</Text></Animated.View>}
      </View>}

      {draft && !draft.submissionId && <View pointerEvents="none" style={s.reviewInfo}>
        <Text style={s.reviewText}>{(draft.trace.durationMs / 1000).toFixed(1)} s · {draft.trace.samples.length} motion samples</Text>
      </View>}
    </View>

    {!!error && <Animated.Text entering={FadeIn} accessibilityRole="alert" numberOfLines={3} style={s.error}>{error}</Animated.Text>}
    {expired && <Text style={s.error}>Words expired. Retake to get new ones.</Text>}

    <View style={s.controls}>
      {draft && !sheetOpen ? <View style={s.reviewRow}>
        <Button kind="dark" title="Retake" onPress={() => void retake()} disabled={busy || !!draft.createAttempted} style={{ flex: 0.6 }} />
        <Button kind="accent" title="Submit" onPress={() => void submit()} disabled={busy || expired} style={{ flex: 1 }} />
      </View>
        : !draft && !enabled ? <View style={s.centerRow}>
          <Button kind="accent" title={busy ? 'Starting' : 'Turn on camera'} icon={<CaptureIcon size={20} color={c.accentInk} />} loading={busy}
            onPress={() => void enableCamera()} disabled={!consent || busy || !task || !!closed} style={{ paddingHorizontal: 28 }} />
          {(!cameraPermission?.canAskAgain || !micPermission?.canAskAgain) && !permitted && cameraPermission && micPermission &&
            <Button kind="dark" title="Open Settings" onPress={() => void Linking.openSettings()} style={{ marginTop: 6 }} />}
        </View>
          : !draft ? <View style={s.centerRow}>
            <RecordButton recording={recording} elapsed={elapsed} disabled={recording ? elapsed < MIN_MS : !ready || busy || !consent}
              onPress={() => recording ? camera.current?.stopRecording() : void record()} />
            <Text style={s.hint}>{recording ? (elapsed < MIN_MS ? `${Math.ceil((MIN_MS - elapsed) / 1000)} s to go` : 'Tap to stop') : !ready ? 'Preparing' : wordsFresh ? '10 to 30 s' : 'New words'}</Text>
          </View> : null}
    </View>

    <Sheet open={sheetOpen} dark>
      {!done ? <>
        <Text style={s.sheetTitle}>{uploading ? 'Uploading' : 'Upload paused'}</Text>
        <View style={{ gap: 10, marginVertical: 6 }}>
          {STAGES.map((stage, index) => {
            const complete = !!draft?.[stage.key];
            const active = !complete && STAGES.slice(0, index).every(prior => !!draft?.[prior.key]);
            return <View key={stage.key} style={s.stage}>
              <View style={[s.stageDot, complete && { backgroundColor: c.accent, borderColor: c.accent }]}>
                {complete ? <CheckIcon size={12} /> : active && uploading ? <ActivityIndicator size="small" color={c.accent} /> : null}
              </View>
              <Text style={[s.stageText, complete && { color: c.paper }]}>{stage.text}</Text>
            </View>;
          })}
        </View>
        {!!progress && <Text style={s.sheetMeta}>{progress}</Text>}
        {!!error && <Text style={s.error}>{error}</Text>}
        {!uploading && <View style={s.reviewRow}>
          <Button kind="dark" title="Later" onPress={() => navigation.goBack()} style={{ flex: 0.6 }} />
          <Button kind="accent" title="Resume" onPress={() => void submit()} style={{ flex: 1 }} />
        </View>}
      </> : <Animated.View entering={enter(0, 380)} style={{ gap: 14 }}>
        <View style={s.successMark}><CheckIcon size={30} width={2.6} /></View>
        <Text style={[s.sheetTitle, { textAlign: 'center' }]}>Submitted</Text>
        <View style={{ alignItems: 'center' }}>{draft?.submissionId && <LiveStatus id={draft.submissionId} />}</View>
        {draft?.attachmentClosed && <Text style={[s.sheetMeta, { textAlign: 'center' }]}>Already reviewed, motion data not attached</Text>}
        <View style={s.reviewRow}>
          <Button kind="dark" title="Status" onPress={() => void finish('Submission')} style={{ flex: 0.6 }} />
          <Button kind="accent" title="Done" onPress={() => void finish('Profile')} style={{ flex: 1 }} />
        </View>
      </Animated.View>}
    </Sheet>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.night },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, marginBottom: 10 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.nightCard, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontFamily: f.medium, fontSize: 17, color: c.paper },
  frame: { flex: 1, marginHorizontal: 10, borderRadius: 26, overflow: 'hidden', backgroundColor: c.nightCard },
  off: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  offText: { fontFamily: f.book, fontSize: 15, color: c.nightMuted },
  words: { position: 'absolute', top: 12, left: 12, right: 12, padding: 14, gap: 4, borderRadius: 20, backgroundColor: 'rgba(14,15,13,0.72)' },
  wordsLabel: { fontFamily: f.mono, fontSize: 10, letterSpacing: 0.8, color: c.accent, textTransform: 'uppercase' },
  wordsText: { fontFamily: f.medium, fontSize: 26, lineHeight: 32, color: c.paper },
  wordsMeta: { fontFamily: f.mono, fontSize: 10, color: c.nightMuted },
  timer: { position: 'absolute', alignSelf: 'center', bottom: 64, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(14,15,13,0.72)' },
  timerText: { fontFamily: f.mono, fontSize: 14, color: c.paper },
  redDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e5484d' },
  coach: { position: 'absolute', bottom: 14, left: 12, right: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  coachPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: c.accent },
  coachText: { fontFamily: f.medium, fontSize: 13, color: c.accentInk },
  reviewInfo: { position: 'absolute', top: 12, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(14,15,13,0.72)' },
  reviewText: { fontFamily: f.mono, fontSize: 11, color: c.paper },
  error: { fontFamily: f.book, fontSize: 13, lineHeight: 18, color: '#ffb4ab', textAlign: 'center', marginTop: 10, paddingHorizontal: 20 },
  controls: { minHeight: 132, justifyContent: 'center', paddingHorizontal: 16 },
  centerRow: { alignItems: 'center', gap: 8 },
  reviewRow: { flexDirection: 'row', gap: 10 },
  record: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: f.mono, fontSize: 11, color: c.nightMuted },
  sheetTitle: { fontFamily: f.medium, fontSize: 20, color: c.paper },
  sheetMeta: { fontFamily: f.mono, fontSize: 11, lineHeight: 16, color: c.nightMuted },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stageDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: c.nightLine, alignItems: 'center', justifyContent: 'center' },
  stageText: { fontFamily: f.regular, fontSize: 15, color: c.nightMuted },
  successMark: { alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
