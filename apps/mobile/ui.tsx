import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors as c, fonts as f, settle } from './theme';

export function Wordmark() {
  return <View accessibilityLabel="Skarl" style={s.wordmark}>
    <Svg viewBox="0 0 500 300" width={28.33} height={17} fill={c.ink}>
      <Rect x="100" y="0" width="100" height="100" rx="36" /><Rect x="300" y="0" width="100" height="100" rx="36" />
      <Rect x="0" y="100" width="100" height="100" rx="36" /><Rect x="200" y="100" width="100" height="100" rx="36" /><Rect x="400" y="100" width="100" height="100" rx="36" />
      <Rect x="100" y="200" width="100" height="100" rx="36" /><Rect x="300" y="200" width="100" height="100" rx="36" />
      <Path d="M58,100 C85.3,100 100,85.3 100,58 L142,58 L142,100 C114.7,100 100,114.7 100,142 L58,142Z M158,100 C185.3,100 200,114.7 200,142 L242,142 L242,100 C214.7,100 200,85.3 200,58 L158,58Z M58,200 C85.3,200 100,214.7 100,242 L142,242 L142,200 C114.7,200 100,185.3 100,158 L58,158Z M258,200 C285.3,200 300,214.7 300,242 L342,242 L342,200 C314.7,200 300,185.3 300,158 L258,158Z M358,200 C385.3,200 400,185.3 400,158 L442,158 L442,200 C414.7,200 400,214.7 400,242 L358,242Z M358,100 C385.3,100 400,114.7 400,142 L442,142 L442,100 C414.7,100 400,85.3 400,58 L358,58Z" />
    </Svg><Text style={s.brand}>Skarl</Text>
  </View>;
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'accent' | 'muted' | 'strong' }) {
  return <View style={[s.pill, tone === 'accent' && { backgroundColor: c.accent }, tone === 'strong' && { backgroundColor: c.haze }]}>
    <Text style={[s.pillText, tone === 'accent' && { color: c.accentInk }, tone === 'strong' && { color: c.ink }]}>{children}</Text>
  </View>;
}
export function StatusPill({ status }: { status: string }) {
  const label: Record<string, string> = { needs_review: 'REVIEW', accepted: 'ACCEPTED', queued: 'QUEUED', analysing: 'ANALYSING', rejected: 'HELD' };
  return <Pill tone={status === 'accepted' ? 'accent' : ['needs_review', 'rejected'].includes(status) ? 'strong' : 'muted'}>{label[status] ?? status.toUpperCase()}</Pill>;
}
export function CardTitle({ step, title, aside }: { step: string; title: string; aside?: ReactNode }) {
  return <View style={s.cardHeader}><View style={s.cardLabel}><Text style={s.step}>{step}</Text><Text accessibilityRole="header" style={s.cardTitle}>{title}</Text></View>{aside}</View>;
}
export function Button({ title, onPress, disabled = false, secondary = false, recording = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; recording?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && { backgroundColor: c.paper }, recording && { backgroundColor: c.accent }, pressed && { opacity: 0.8 }, disabled && { backgroundColor: c.haze }]}>
    <Text style={[s.buttonText, secondary && { color: c.deep }, recording && { color: c.accentInk }, disabled && { color: c.slate500 }]}>{title}</Text>
  </Pressable>;
}
export function Stepper({ current }: { current: 0 | 1 | 2 }) {
  return <View accessibilityLabel={`Step ${current + 1} of 3: ${['Record', 'Upload', 'Verify'][current]}`} style={s.stepper}>
    {['Record', 'Upload', 'Verify'].map((label, index) => <View key={label} style={s.stepItem}>
      <View style={[s.stepCircle, index === current && { backgroundColor: c.deep }, index < current && { backgroundColor: c.accent }]}>
        <Text style={[s.stepNumber, index === current && { color: c.paper }]}>{index < current ? '✓' : index + 1}</Text>
      </View><Text style={[s.stepName, index === current && { color: c.ink }]}>{label}</Text>
      {index < 2 && <View style={s.stepLine} />}
    </View>)}
  </View>;
}

// Wait for the accessibility preference before animating; never assume motion is OK.
export function Settle({ children }: { children: ReactNode }) {
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let mounted = true;
    const onPreference = (reduced: boolean) => {
      if (!mounted) return;
      progress.stopAnimation();
      if (reduced) { progress.setValue(1); return; }
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 600, easing: Easing.bezier(...settle), useNativeDriver: Platform.OS !== 'web' }).start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(onPreference).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', onPreference);
    return () => { mounted = false; subscription.remove(); progress.stopAnimation(); };
  }, [progress]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>{children}</Animated.View>;
}

export const formatMs = (ms: number) => {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths % 600 / 10)).padStart(2, '0')}.${tenths % 10}`;
};
type Criterion = { criterionId: string; status: string; reason: string; evidence: { startMs: number; endMs: number; modality: string; claim: string }[] };
export function EvidenceTimeline({ criteria }: { criteria: Criterion[] }) {
  const duration = Math.max(1, ...criteria.flatMap(criterion => criterion.evidence.map(e => e.endMs)));
  return <View style={{ gap: 16 }}>
    <View style={s.timeline}>
      {['video', 'audio'].map(lane => <View key={lane} style={s.lane}>
        <Text style={s.laneLabel}>{lane.toUpperCase()}</Text><View style={s.track}>
          {criteria.flatMap((criterion, ci) => criterion.evidence.filter(e => e.modality === lane).map((e, ei) => <View key={`${ci}-${ei}`}
            style={[s.range, { left: `${e.startMs / duration * 100}%`, width: `${Math.max(1, (e.endMs - e.startMs) / duration * 100)}%`, backgroundColor: criterion.status === 'supported' ? c.slate700 : c.fog }]} />))}
        </View>
      </View>)}
      <View style={s.axis}><Text style={s.data}>0:00</Text><Text style={s.data}>{formatMs(duration)}</Text></View>
    </View>
    {criteria.map(criterion => <View key={criterion.criterionId} style={s.criterion}>
      <View style={s.criterionHeading}><Text style={s.criterionTitle}>{criterion.criterionId.replace(/-/g, ' ')}</Text><Pill tone={criterion.status === 'contradicted' ? 'strong' : 'muted'}>{criterion.status.toUpperCase()}</Pill></View>
      <Text style={s.body}>{criterion.reason}</Text>
      {criterion.evidence.map((e, index) => <View key={index} style={s.evidence}>
        <Text style={s.data}>{formatMs(e.startMs)}–{formatMs(e.endMs)} · {e.modality.toUpperCase()}</Text>
        <Text style={s.body}>{e.claim}</Text>
      </View>)}
    </View>)}
  </View>;
}
const s = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 4 }, brand: { fontFamily: f.medium, fontSize: 20, letterSpacing: -0.6, color: c.ink },
  pill: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: c.hazeMuted },
  pillText: { fontFamily: f.mono, fontSize: 12, lineHeight: 12, color: c.slate500 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, cardLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  step: { fontFamily: f.mono, fontSize: 12, color: c.slate300 }, cardTitle: { fontFamily: f.regular, fontSize: 20, lineHeight: 24, color: c.deep },
  button: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: c.slate700, justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontFamily: f.medium, fontSize: 14, color: c.mist, textAlign: 'center', lineHeight: 18 },
  stepper: { flexDirection: 'row', paddingVertical: 18 }, stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  stepCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.mist, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { fontFamily: f.mono, fontSize: 11, color: c.slate500 }, stepName: { fontFamily: f.book, fontSize: 12, color: c.slate500 }, stepLine: { flex: 1, height: 1, marginRight: 7, backgroundColor: c.haze },
  timeline: { gap: 10, padding: 12, backgroundColor: c.paper, borderRadius: 10 }, lane: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  laneLabel: { width: 40, fontFamily: f.mono, fontSize: 10, color: c.slate500 }, track: { flex: 1, height: 16, backgroundColor: c.mist, borderRadius: 4, overflow: 'hidden' },
  range: { position: 'absolute', height: 16, borderRadius: 3 }, axis: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 48 },
  data: { fontFamily: f.mono, fontSize: 11, color: c.slate500, lineHeight: 16 }, body: { fontFamily: f.book, fontSize: 14, lineHeight: 20, color: c.slate500 },
  criterion: { gap: 8 }, criterionHeading: { gap: 8 }, criterionTitle: { fontFamily: f.regular, fontSize: 16, color: c.ink },
  evidence: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.haze, gap: 4 },
});
