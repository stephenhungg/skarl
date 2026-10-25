import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from 'convex/react';
import { enter } from '../components/motion';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors as c, fonts as f, gutter } from '../../theme';
import { api, identity } from '../api';
import { Card, Empty, StatusPill, t } from '../components/Primitives';
import { EvidenceTimeline } from '../components/EvidenceTimeline';
import { ChevronLeft } from '../components/Icons';
import { PressableScale } from '../components/PressableScale';
import type { RootProps } from '../navigation';

const ADVICE: Record<string, string> = {
  accept: 'Recommended for acceptance', request_correction: 'Held, nothing paid', manual_review: 'Waiting on a person',
};

export function SubmissionScreen({ navigation, route }: RootProps<'Submission'>) {
  const insets = useSafeAreaInsets();
  const { submissionId } = route.params;
  const result = useQuery(api.report, { ...identity, submissionId });
  return <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, paddingHorizontal: gutter }}>
    <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={s.back}><ChevronLeft /></PressableScale>
    <Animated.View entering={enter(0, 400)} style={s.head}>
      <Text accessibilityRole="header" style={s.title}>Take {submissionId.slice(-5).toUpperCase()}</Text>
      {result && <StatusPill status={result.status} />}
    </Animated.View>
    {!result && <ActivityIndicator color={c.slate500} style={{ marginTop: 30 }} />}
    {result && <Animated.View entering={enter(80, 400)} style={{ gap: 12, marginTop: 16 }}>
      {result.status === 'accepted' && <Card tone="mist" style={{ padding: 14 }}><Text style={t.bodyInk}>Accepted. Payout follows buyer-policy or buyer-review approval.</Text></Card>}
      {result.report ? <Card style={{ gap: 14 }}>
        <Text style={s.advice}>{ADVICE[result.report.recommendation] ?? 'Waiting on a person'}</Text>
        <EvidenceTimeline criteria={result.report.criteria} />
      </Card> : <Empty title="Analysing" />}
      <Text selectable style={[t.meta, { textAlign: 'center' }]}>{submissionId}</Text>
    </Animated.View>}
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  title: { fontFamily: f.medium, fontSize: 28, letterSpacing: -0.5, color: c.ink },
  advice: { fontFamily: f.medium, fontSize: 16, color: c.ink },
});
