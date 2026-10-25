import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { colors as c, fonts as f, gutter } from './theme';
import { Button, CardTitle, EvidenceTimeline, Pill, Settle, StatusPill, Stepper, Wordmark } from './ui';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { ConvexProvider, ConvexReactClient, useConvex, useConvexConnectionState, useQuery } from 'convex/react';
import { api, identity, usdc } from './src/api';
import { availableSensors, startTrace, type Sensor } from './src/sensors';
import { clearDraft, loadDraft, saveDraft, submitDraft, type Draft } from './src/upload';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const client = url && /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url) ? new ConvexReactClient(url) : null;
const CONSENT = [
  "I'm the person in this clip, and nobody else can be seen or heard in it.",
  'I license this clip to the buyer for model training under the demo license (demo-consent-v1), and the original stays in private storage.',
  'This is a testnet demo, and payment is test USDC on Base Sepolia sent only after a person approves an accepted clip.',
];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={s.camera} nativeControls contentFit="contain" />;
}
function SubmissionStatus({ id }: { id: string }) {
  const result = useQuery(api.report, { ...identity, submissionId: id });
  if (!result) return <Text style={s.body}>Connecting to live submission status…</Text>;
  return <View style={s.card}>
    <CardTitle step="04" title="Your submission" aside={<StatusPill status={result.status} />} />
    <Text style={s.body}>{result.status === 'accepted'
      ? 'Accepted. Payment still requires independent approval and a confirmed transfer.'
      : 'A person reviews your clip before acceptance. Analysis and motion data cannot approve payment.'}</Text>
    {!result.report && <Text style={s.body}>Waiting for analysis. You can leave this screen and return later.</Text>}
    {result.report && <>
      <Text style={s.meta}>Analysis: {result.report.pipeline.status} · {result.report.pipeline.implementation}</Text>
      <Text style={s.label}>{result.report.recommendation === 'accept' ? 'Recommends acceptance · payable on approval'
        : result.report.recommendation === 'request_correction' ? 'Held, nothing is paid' : 'Waiting on a person'}</Text>
      <EvidenceTimeline criteria={result.report.criteria} />
    </>}
    <Text selectable style={s.meta}>Submission {id}</Text>
  </View>;
}

function Contribute() {
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const context = useQuery(api.context, identity);
  const summary = useQuery(api.summary, context ? { ...identity, orderId: context.orderId } : 'skip');
  const [cameraPermission, askCamera] = useCameraPermissions();
  const [micPermission, askMic] = useMicrophonePermissions();
  const [consent, setConsent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recordedDuration = useRef(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);
  const trace = useRef<ReturnType<typeof startTrace> | null>(null);
  const captureBusy = useRef(false);
  const uploadBusy = useRef(false);
  const interrupted = useRef(false);
  const permitted = cameraPermission?.granted && micPermission?.granted;
  const closed = summary && ['closed', 'cancelled', 'cancelling', 'fulfilled', 'refunded'].includes(summary.order.status);

  useEffect(() => {
    let mounted = true;
    loadDraft().then(value => { if (mounted) { setDraft(value); if (value) setConsent(true); } })
      .catch(error => { if (mounted) setError(`Could not restore saved contribution: ${message(error)}`); })
      .finally(() => { if (mounted) setRestoring(false); });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && captureBusy.current) {
        interrupted.current = true;
        trace.current?.stop();
        camera.current?.stopRecording();
      }
      if (state !== 'active') { setEnabled(false); setReady(false); }
    });
    return () => { mounted = false; subscription.remove(); trace.current?.stop(); camera.current?.stopRecording(); };
  }, []);

  async function enableCamera() {
    setBusy(true); setError(null);
    try {
      const cam = await askCamera();
      const mic = await askMic();
      if (!cam.granted || !mic.granted) throw new Error('Camera and microphone access are required. Enable both in iPhone Settings.');
      const available = await availableSensors().catch(() => [] as Sensor[]);
      setSensors(available); setReady(false); setEnabled(true);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function record() {
    if (!camera.current || !context || !ready || !consent || captureBusy.current) return;
    captureBusy.current = true; interrupted.current = false; recordedDuration.current = 0; setError(null); setElapsed(0); setRecording(true);
    try {
      trace.current = startTrace(sensors);
      const result = await camera.current.recordAsync({ maxDuration: 30, maxFileSize: 24 * 1024 * 1024, codec: 'avc1', progressUpdateInterval: 0.1 });
      const data = trace.current.stop();
      if (interrupted.current) throw new Error('Recording was interrupted. Keep Skarl open and record a new take.');
      if (!result?.uri || recordedDuration.current < 10_000) throw new Error('Record at least 10 seconds. Please try again.');
      const clientRequestId = Crypto.randomUUID();
      const extension = /\.mov(?:\?|$)/i.test(result.uri) ? 'mov' : 'mp4';
      const file = new File(Paths.document, `skarl-${clientRequestId}.${extension}`);
      new File(result.uri).copy(file);
      const next: Draft = { uri: file.uri, clientRequestId, orderId: context.orderId, trace: data };
      setDraft(next);
      await saveDraft(next);
      setEnabled(false); setReady(false);
    } catch (error) { setError(message(error)); }
    finally {
      trace.current?.stop(); trace.current = null; captureBusy.current = false; setRecording(false);
    }
  }

  async function submit() {
    if (!draft || !consent || uploadBusy.current) return;
    uploadBusy.current = true; setBusy(true); setError(null);
    try { await submitDraft(convex, draft, (next, progress) => { setDraft(next); setLabel(progress); }); }
    catch (error) { setError(message(error)); }
    finally { uploadBusy.current = false; setBusy(false); }
  }

  async function retake() {
    if (draft?.createAttempted && !draft.attached && !draft.attachmentClosed) return;
    try {
      await clearDraft();
      if (draft) { const file = new File(draft.uri); if (file.exists) file.delete(); }
      setDraft(null); setError(null); setLabel(''); setElapsed(0); setEnabled(false); setReady(false); setConsent(false);
    } catch (error) { setError(message(error)); }
  }

  if (restoring) return <View style={s.card}><ActivityIndicator color={c.slate700} /><Text style={s.body}>Restoring your contribution…</Text></View>;
  return <ScrollView contentContainerStyle={s.content}>
    <View style={s.header}><Wordmark /><View><Pill>TESTNET DEMO</Pill></View></View>
    <Settle><View style={s.intro}>
      <Text style={s.eyebrow}>Contribute</Text>
      <Text accessibilityRole="header" style={s.heading}>{draft ? 'Your contribution' : 'Record a task'}</Text>
      <Text style={[s.body, { marginTop: 6 }]}>Read the brief, agree to the terms, then film one 10 to 30 second take while you narrate. You can follow the clip from upload to review here.</Text>
      <View style={[s.row, { marginTop: 10 }]}><Pill tone={context && summary && connection.isWebSocketConnected ? 'accent' : 'muted'}>{context && summary && connection.isWebSocketConnected ? 'LIVE' : 'CONNECTING'}</Pill><Text style={s.meta}>Video + audio + motion</Text></View>
      <Text style={s.caption}>Signed in as the demo contributor account.</Text>
    </View></Settle>
    {!draft && <View style={s.card}>
      <CardTitle step="01" title="Task brief" aside={<Pill tone={summary?.rubric ? 'accent' : 'muted'}>{summary?.rubric ? 'LIVE RUBRIC' : 'LOADING'}</Pill>} />
      <View style={{ gap: 8, marginTop: 6 }}>
        <Text style={s.taskTitle}>{summary?.order.title ?? (context === null ? 'Demo order not available' : 'Loading the live task…')}</Text>
        {summary?.rubric && <Text style={s.body}>{summary.rubric.taskPrompt.replace(/–/g, ' to ')}</Text>}
      </View>
      {summary?.rubric && <>
        <View style={{ gap: 6, marginTop: 6 }}>
          {summary.rubric.criteria.map(criterion => <View key={criterion.criterionId} style={s.criterionRow}>
            <Text style={s.checkMark}>✓</Text><Text style={[s.label, { flex: 1 }]}>{criterion.description}</Text>
            {criterion.modality && <Pill>{criterion.modality.replace('_', '-').toUpperCase()}</Pill>}
          </View>)}
        </View>
        <View style={[s.row, { marginTop: 6, alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.eyebrow}>Pay per accepted clip</Text><Text style={s.amount}>{usdc(summary.order.contributorRateAtomic)} test USDC</Text></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.eyebrow}>Open spots</Text><Text style={s.amount}>{(BigInt(summary.order.quantityRequested) - BigInt(summary.order.acceptedCount)).toString()} of {summary.order.quantityRequested}</Text></View>
        </View>
        <View style={{ gap: 4 }}><Text style={s.eyebrow}>Rubric version</Text><Text style={s.meta}>v{summary.rubric.version} · {summary.rubric.contentHash.slice(0, 10)}…{summary.rubric.contentHash.slice(-4)}</Text></View>
        <Text style={s.notice}>{summary.order.status === 'funded' ? 'Funded and open.' : `Order status: ${summary.order.status.replace(/_/g, ' ')}.`} Payouts are Base Sepolia test USDC.</Text>
      </>}
      {closed && <Text style={s.error}>This order is closed to new contributions.</Text>}
    </View>}
    {!draft && <View style={s.card}>
      <CardTitle step="02" title="Consent" aside={<Pill>{consent ? 'AGREED' : 'REQUIRED'}</Pill>} />
      <Text style={s.body}>The camera stays off until you agree to all the terms.</Text>
      {CONSENT.map(text => <View key={text} style={s.consentRow}><Text style={s.label}>{text}</Text></View>)}
      <Text style={s.body}>I also agree to share synchronized accelerometer, gyroscope and device motion data with this contribution. No location is collected.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="I agree to all contribution and sensor terms" accessibilityState={{ checked: consent, disabled: busy || recording }} disabled={busy || recording}
        onPress={() => { setConsent(!consent); if (consent) { setEnabled(false); setReady(false); } }} style={s.consentRow}>
        <View style={[s.checkbox, consent && { backgroundColor: c.accent }]}><Text style={s.checkText}>{consent ? '✓' : ''}</Text></View>
        <Text style={[s.label, { flex: 1 }]}>I agree to all of these terms</Text>
      </Pressable>
    </View>}
    <Stepper current={draft?.submissionId ? 2 : draft ? 1 : 0} />
    {!draft && <View style={s.card}>
      <CardTitle step="03" title="Record" aside={recording ? <Pill tone="accent">RECORDING</Pill> : undefined} />
      <Text style={s.body}>Set the camera where it can see both cups and the coaster, then narrate as you go. Takes run 10 to 30 seconds and stop on their own at 30.</Text>
      {enabled && permitted && consent
        ? <CameraView ref={camera} style={s.camera} facing="back" mode="video" videoQuality="720p" videoBitrate={4_000_000} mute={false}
          onRecordingProgress={event => { recordedDuration.current = event.duration * 1000; setElapsed(recordedDuration.current); }}
          onCameraReady={() => setReady(true)} onMountError={event => { setReady(false); setError(event.message); }} />
        : <View style={[s.camera, s.placeholder]}><Text style={[s.placeholderText, { fontFamily: f.regular, fontSize: 18 }]}>Camera is off</Text><Text style={s.placeholderText}>Agree to the consent terms to turn it on.</Text><Text style={s.cameraMeta}>BACK CAMERA · PORTRAIT</Text></View>}
      {enabled && <Text style={s.meta}>{sensors.length ? `Motion capture: ${sensors.join(', ')} · target 50 Hz` : 'Motion unavailable or permission denied. The trace will explicitly contain no samples.'}</Text>}
      <Text style={recording ? s.meta : s.body}>{recording ? `${(elapsed / 1000).toFixed(1)} / 30 seconds · recording video, audio and motion` : 'Keep the camera fixed as the task asks. Include red and blue cups and the marked coaster.'}</Text>
      {!enabled ? <Button title="Turn on camera" onPress={() => void enableCamera()} disabled={!consent || busy || !summary?.rubric || !!closed} />
        : recording ? <Button recording title={elapsed < 10_000 ? 'Keep recording (10 seconds minimum)' : 'Stop recording'} onPress={() => camera.current?.stopRecording()} disabled={elapsed < 10_000} />
          : <Button title={ready ? 'Record take' : 'Preparing camera…'} onPress={() => void record()} disabled={!ready || busy || !consent} />}
      {(!cameraPermission?.canAskAgain || !micPermission?.canAskAgain) && !permitted && <Button title="Open iPhone Settings" onPress={() => void Linking.openSettings()} secondary />}
    </View>}
    {draft && <View style={s.card}>
      <CardTitle step="03" title="Review & submit" />
      {!draft.submissionId && <Preview uri={draft.uri} />}
      <Text style={s.title}>{(draft.trace.durationMs / 1000).toFixed(1)} seconds · {draft.trace.samples.length} motion samples</Text>
      <Text style={s.body}>{draft.trace.sensors.length ? draft.trace.sensors.join(' · ') : 'No motion samples available'}</Text>
      <Text style={s.meta}>Video and sensor trace stay private. Timing is approximate, based on app callback times.</Text>
      {!!label && <Text style={s.label}>{label}</Text>}
      {busy && <ActivityIndicator color={c.slate700} />}
      {!draft.attached && !draft.attachmentClosed && <Button title={busy ? 'Submitting…' : draft.createAttempted ? 'Resume submission and sensor attachment' : 'Submit consented contribution'} onPress={() => void submit()} disabled={busy} />}
      {(!draft.createAttempted || draft.attached || draft.attachmentClosed) && <Button title={draft.submissionId ? 'Record another contribution' : 'Discard and retake'} onPress={() => void retake()} disabled={busy} secondary />}
      {draft.submissionId && !draft.attached && !draft.attachmentClosed && <Text style={s.error}>Video submission exists. Sensors are not attached yet; resume to complete it.</Text>}
    </View>}
    {error && <View style={s.card}><Text accessibilityRole="alert" selectable style={s.error}>{error}</Text></View>}
    {draft?.submissionId && <SubmissionStatus id={draft.submissionId} />}
    <Text style={s.footer}>Base Sepolia · test USDC · demo identities{'\n'}No real customer funds. Original media is private.</Text>
  </ScrollView>;
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: message(error) }; }
  render() {
    return this.state.error ? <View style={s.content}><Text style={s.title}>The backend is unavailable</Text>
      <Text selectable style={s.error}>{this.state.error}</Text><Text style={s.body}>Your saved contribution remains on this device. Check the connection and retry.</Text>
      <Button title="Retry connection" onPress={() => this.setState({ error: null })} /></View> : this.props.children;
  }
}
export default function App() {
  const [loaded, fontError] = useFonts({
    MontrealBook: require('./assets/fonts/montreal-book.otf'),
    MontrealRegular: require('./assets/fonts/montreal-regular.otf'),
    MontrealMedium: require('./assets/fonts/montreal-medium.otf'),
    Fono: require('./assets/fonts/fono.otf'),
  });
  if (!loaded && !fontError) return <SafeAreaProvider><SafeAreaView style={s.screen}><ActivityIndicator color={c.slate700} /></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><SafeAreaView style={s.screen}><StatusBar style="dark" />
    {client ? <ConvexProvider client={client}><Boundary><Contribute /></Boundary></ConvexProvider>
      : <View style={s.content}><Text style={s.title}>Connect Skarl</Text><Text style={s.body}>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env to https://keen-marmot-986.convex.cloud, then restart Expo.</Text></View>}
  </SafeAreaView></SafeAreaProvider>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper }, content: { paddingHorizontal: gutter, gap: 12, paddingBottom: 48 },
  header: { height: 64, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6 },
  intro: { paddingTop: 20, paddingBottom: 16, gap: 6 },
  eyebrow: { fontFamily: f.book, fontSize: 14, lineHeight: 17, color: c.slate300 },
  heading: { fontFamily: f.regular, fontSize: 32, lineHeight: 38.4, letterSpacing: -0.48, color: c.ink },
  title: { fontFamily: f.regular, fontSize: 20, lineHeight: 26, color: c.deep },
  taskTitle: { fontFamily: f.regular, fontSize: 16, lineHeight: 20, letterSpacing: 0.16, color: c.ink },
  body: { fontFamily: f.book, fontSize: 14, lineHeight: 19.6, letterSpacing: 0.14, color: c.slate500 },
  label: { fontFamily: f.book, fontSize: 14, lineHeight: 18.2, color: c.ink },
  meta: { fontFamily: f.mono, fontSize: 11, lineHeight: 16, color: c.slate500 },
  amount: { fontFamily: f.mono, fontSize: 12, lineHeight: 17, color: c.ink },
  caption: { fontFamily: f.book, fontSize: 12, lineHeight: 15, color: c.fog },
  card: { backgroundColor: c.mist, padding: 18, borderRadius: 12, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  criterionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: c.paper, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  checkMark: { width: 16, fontFamily: f.book, fontSize: 16, color: c.slate300 },
  notice: { backgroundColor: c.hazeSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: f.book, fontSize: 13, lineHeight: 17.5, color: c.slate700, marginTop: 6 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 10, backgroundColor: c.paper },
  checkbox: { width: 20, height: 20, borderRadius: 5, backgroundColor: c.haze, alignItems: 'center', justifyContent: 'center' },
  checkText: { fontSize: 14, color: c.accentInk },
  camera: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, overflow: 'hidden', backgroundColor: c.ink },
  placeholder: { justifyContent: 'center', alignItems: 'center', padding: 18, gap: 10 },
  placeholderText: { fontFamily: f.book, color: c.haze, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  cameraMeta: { fontFamily: f.mono, color: c.slate300, fontSize: 10, marginTop: 14 },
  error: { color: c.deep, fontFamily: f.book, fontSize: 14, lineHeight: 21 },
  footer: { fontFamily: f.mono, fontSize: 10, lineHeight: 18, color: c.slate500, textAlign: 'center', marginTop: 16 },
});
