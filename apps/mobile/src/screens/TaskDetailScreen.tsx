import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter, timing } from '../components/motion';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { colors as c, fonts as f, gutter, radius } from '../../theme';
import { money } from '../api';
import { useLiveTask } from '../data';
import { useSession } from '../session';
import { CONSENT } from '../consent';
import { Button, Empty, Pill, Section } from '../components/Primitives';
import { Sheet } from '../components/Sheet';
import { PressableScale } from '../components/PressableScale';
import { TaskArt } from '../components/TaskArt';
import { CaptureIcon, CheckIcon, ChevronLeft, ClockIcon, SensorIcon, TasksIcon } from '../components/Icons';
import type { RootProps } from '../navigation';

function Checkbox({ checked, label, onPress, disabled }: { checked: boolean; label: string; onPress(): void; disabled?: boolean }) {
  const box = useAnimatedStyle(() => ({
    backgroundColor: withTiming(checked ? c.accent : c.card, { duration: 160 }),
    borderColor: withTiming(checked ? c.accent : c.fog, { duration: 160 }),
  }), [checked]);
  return <PressableScale accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} accessibilityLabel={label} disabled={disabled}
    onPress={onPress} style={s.consent} scale={0.98}>
    <Animated.View style={[s.box, box]}>{checked && <CheckIcon />}</Animated.View>
    <Text style={s.consentText}>{label}</Text>
  </PressableScale>;
}

export function TaskDetailScreen({ navigation }: RootProps<'TaskDetail'>) {
  const insets = useSafeAreaInsets();
  const { task, loading } = useLiveTask();
  const { draft } = useSession();
  const [sheet, setSheet] = useState(false);
  const [agreed, setAgreed] = useState<boolean[]>(CONSENT.map(() => false));
  // Consent is per take: coming back to this screen always starts unchecked.
  useFocusEffect(useCallback(() => { setAgreed(CONSENT.map(() => false)); setSheet(false); }, []));
  const all = agreed.every(Boolean);
  const pendingTake = !!draft && !draft.attached && !draft.attachmentClosed;

  return <View style={s.screen}>
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
      <View>
        <TaskArt style={[s.hero, { paddingTop: insets.top }]} />
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={[s.back, { top: insets.top + 8 }]}>
          <ChevronLeft />
        </PressableScale>
      </View>
      {loading && <View style={{ padding: gutter }}><View style={s.skeleton} /></View>}
      {!loading && !task && <View style={{ padding: gutter }}><Empty title="Task closed" /></View>}
      {task && <View style={{ paddingHorizontal: gutter }}>
        <Animated.View entering={enter(0, 420)} style={{ marginTop: 20, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {task.closed && <Pill tone="danger">Closed</Pill>}
          </View>
          <Text accessibilityRole="header" style={s.title}>{task.title}</Text>
        </Animated.View>

        <Animated.View entering={enter(70, 420)} style={s.stats}>
          <View style={[s.stat, s.payStat]}>
            <Text style={s.statLabelInk}>Pays</Text>
            <Text style={s.payValue}>{money(task.rateAtomic)}</Text>
            <Text style={s.statLabelInk}>USDC / video</Text>
          </View>
          <View style={s.stat}>
            <ClockIcon size={18} color={c.slate700} />
            <Text style={s.statValue}>10 to 30 s</Text>
            <Text style={s.statLabel}>Video</Text>
          </View>
          <View style={s.stat}>
            <TasksIcon size={18} color={c.slate700} />
            <Text style={s.statValue}>{task.openSpots} of {task.quantity}</Text>
            <Text style={s.statLabel}>Spots</Text>
          </View>
        </Animated.View>

        <Section title="Steps" />
        <View style={{ gap: 8 }}>
          {task.criteria.map((criterion, index) => <Animated.View key={criterion.criterionId} entering={enter(140 + index * 60, 420)} style={s.step}>
            <View style={s.stepNumber}><Text style={s.stepNumberText}>{index + 1}</Text></View>
            <Text style={s.stepText}>{criterion.description}</Text>
          </Animated.View>)}
          <Animated.View entering={enter(140 + task.criteria.length * 60, 420)} style={s.step}>
            <View style={[s.stepNumber, { backgroundColor: c.mist }]}><SensorIcon size={15} color={c.ink} /></View>
            <Text style={s.stepText}>Keep the phone fixed and narrate</Text>
          </Animated.View>
        </View>
      </View>}
    </ScrollView>
    {task && <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {pendingTake
        ? <Button title="Review saved take" onPress={() => navigation.navigate('Capture', { consented: true })} style={{ minHeight: 58 }} />
        : <Button title="Start recording" icon={<CaptureIcon size={20} color={c.accent} />} disabled={task.closed}
          onPress={() => setSheet(true)} style={{ minHeight: 58 }} />}
    </View>}
    <Sheet open={sheet} onClose={() => setSheet(false)}>
      <Text style={s.sheetTitle}>Before you record</Text>
      <View style={{ gap: 8 }}>
        {CONSENT.map((text, index) => <Checkbox key={text} label={text} checked={agreed[index]!}
          onPress={() => setAgreed(previous => previous.map((value, i) => i === index ? !value : value))} />)}
      </View>
      <Button title={all ? 'Open camera' : `Agree ${agreed.filter(Boolean).length} of ${CONSENT.length}`} disabled={!all}
        onPress={() => { setSheet(false); navigation.navigate('Capture', { consented: true }); }} style={{ minHeight: 56, marginTop: 6 }} />
      <PressableScale accessibilityRole="button" onPress={() => setAgreed(CONSENT.map(() => true))} style={{ alignSelf: 'center', padding: 8 }}>
        <Text style={s.agreeAll}>Agree to all</Text>
      </PressableScale>
    </Sheet>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  hero: { height: 300, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  back: { position: 'absolute', left: gutter, width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  title: { fontFamily: f.medium, fontSize: 28, lineHeight: 33, letterSpacing: -0.5, color: c.ink, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 18 },
  stat: { flex: 1, padding: 14, borderRadius: 18, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, gap: 6, justifyContent: 'space-between' },
  payStat: { flex: 1.25, backgroundColor: c.accent, borderColor: c.accent },
  statValue: { fontFamily: f.medium, fontSize: 17, color: c.ink },
  statLabel: { fontFamily: f.book, fontSize: 12, color: c.slate500 },
  statLabelInk: { fontFamily: f.medium, fontSize: 12, color: c.accentInk, opacity: 0.7 },
  sheetTitle: { fontFamily: f.medium, fontSize: 20, color: c.ink, marginBottom: 4 },
  agreeAll: { fontFamily: f.medium, fontSize: 14, color: c.slate700 },
  payBand: { marginTop: 20, padding: 18, borderRadius: radius.card, backgroundColor: c.accent, gap: 4 },
  payLabel: { fontFamily: f.medium, fontSize: 13, color: c.accentInk, opacity: 0.75 },
  payValue: { fontFamily: f.medium, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: c.accentInk },
  payUnit: { fontFamily: f.regular, fontSize: 17, letterSpacing: 0 },
  payNote: { fontFamily: f.book, fontSize: 13, lineHeight: 18, color: c.accentInk, opacity: 0.75 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  infoIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.mist, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontFamily: f.regular, fontSize: 15, color: c.ink, width: 76 },
  infoValue: { flex: 1, fontFamily: f.book, fontSize: 14, lineHeight: 18, color: c.slate500, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginLeft: 44 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: f.medium, fontSize: 13, color: c.paper },
  stepText: { flex: 1, fontFamily: f.regular, fontSize: 15, lineHeight: 20, color: c.ink },
  modality: { fontFamily: f.mono, fontSize: 10, color: c.slate500, textTransform: 'uppercase' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentText: { flex: 1, fontFamily: f.book, fontSize: 14, lineHeight: 19, color: c.ink },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: gutter, backgroundColor: 'rgba(253,253,250,0.94)',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
  skeleton: { height: 220, borderRadius: radius.card, backgroundColor: c.mist },
});
