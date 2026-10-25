import { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '../components/motion';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors as c, fonts as f, gutter, radius } from '../../theme';
import { money } from '../api';
import { IN_REVIEW, totals, useContributorActivity, when } from '../data';
import { useSession } from '../session';
import { Button, Empty, H1, ListRow, Pill, StatusPill, t } from '../components/Primitives';
import { Segmented } from '../components/Segmented';
import { CountUp } from '../components/CountUp';
import { Sheet } from '../components/Sheet';
import { PressableScale } from '../components/PressableScale';
import { ChevronRight, LinkIcon } from '../components/Icons';
import type { TabProps } from '../navigation';

const SEGMENTS = ['Payouts', 'Submissions', 'Ledger'] as const;
type Segment = (typeof SEGMENTS)[number];

export function WalletScreen({ navigation, route }: TabProps<'Wallet'>) {
  const insets = useSafeAreaInsets();
  const { earnings, submissions, loading, error } = useContributorActivity();
  const { draft } = useSession();
  const [segment, setSegment] = useState<Segment>('Submissions');
  const [manage, setManage] = useState(false);
  useEffect(() => { if (route.params?.segment) setSegment(route.params.segment); }, [route.params?.segment]);

  const sum = totals(earnings.rows);
  const times = useMemo(() => new Map(submissions.map(row => [row._id, row._creationTime])), [submissions]);
  const payables = useMemo(() => (earnings.rows ?? []).filter(row => row.payableStatus)
    .sort((a, b) => (times.get(b.submissionId) ?? 0) - (times.get(a.submissionId) ?? 0)), [earnings.rows, times]);
  const payouts = payables.filter(row => row.payout.status === 'paid' || row.payableStatus === 'payout_in_progress');
  const unsent = draft && !draft.submissionId ? 1 : 0;
  const pending = submissions.filter(row => IN_REVIEW.includes(row.status)).length + unsent;

  return <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 120, paddingHorizontal: gutter }}>
    <Animated.View entering={FadeIn.duration(400)}><H1>Wallet</H1></Animated.View>

    <Animated.View entering={enter(60, 460)} style={s.balance}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.balanceLabel}>Pending</Text>
        <Pill tone="ink">Test USDC</Pill>
      </View>
      {earnings.error ? <Text style={s.amount}>0.00</Text> : <CountUp atomic={sum.pending} style={s.amount} />}
      <View style={s.paidRow}>
        <Text style={s.paidLabel}>Paid</Text>
        <CountUp atomic={sum.paid} style={s.paidValue} />
      </View>
      {earnings.error && <Text style={s.unavailable}>Earnings unavailable right now</Text>}
    </Animated.View>

    <Animated.View entering={enter(120, 460)}>
      <PressableScale accessibilityRole="button" onPress={() => unsent ? navigation.navigate('Capture', { consented: true }) : setSegment('Submissions')} style={s.pending}>
        <View style={s.pendingCount}><Text style={s.pendingNumber}>{pending}</Text></View>
        <Text style={s.pendingText}>{pending === 1 ? 'Pending upload' : 'Pending uploads'}</Text>
        <ChevronRight />
      </PressableScale>
    </Animated.View>

    <Animated.View entering={enter(170, 460)} style={s.actions}>
      <Button kind="secondary" title="Manage" onPress={() => setManage(true)} style={{ flex: 1 }} />
      <Button title="Cash out" disabled style={{ flex: 1 }} />
    </Animated.View>
    <Text style={s.note}>Payouts are approved by a controller</Text>

    <View style={{ marginTop: 22, marginBottom: 12 }}>
      <Segmented<Segment> options={SEGMENTS} value={segment} onChange={setSegment} />
    </View>

    {loading && <View style={{ gap: 8 }}>{[0, 1, 2].map(i => <View key={i} style={s.skeleton} />)}</View>}
    {!loading && error && segment === 'Submissions' && !submissions.length && <Empty title="Could not load" />}

    {!loading && segment === 'Submissions' && (submissions.length ? <View style={{ gap: 8 }}>
      {submissions.map((row, index) => <Animated.View key={row._id} entering={enter(Math.min(index, 8) * 45, 360)}>
        <ListRow title={`Take ${row._id.slice(-5).toUpperCase()}`} detail={`${when(row._creationTime)}${row.verificationOnly ? ' · Test' : ''}`}
          aside={<StatusPill status={row.status} />} onPress={() => navigation.navigate('Submission', { submissionId: row._id })} />
      </Animated.View>)}
    </View> : !error && <Empty title="No submissions yet" action={<Button title="Find a task" onPress={() => navigation.navigate('Tasks')} style={{ marginTop: 10, minHeight: 44 }} />} />)}

    {!loading && segment === 'Payouts' && (payouts.length ? <View style={{ gap: 8 }}>
      {payouts.map((row, index) => <Animated.View key={row.submissionId} entering={enter(index * 45, 360)}>
        <ListRow title={`${money(row.payout.amountAtomic ?? row.amountAtomic)} USDC`} detail={row.payout.txHash ? `${row.payout.txHash.slice(0, 10)}...` : 'In progress'}
          aside={row.payout.explorerUrl ? <LinkIcon /> : <StatusPill status={row.payout.status === 'paid' ? 'paid' : 'payout_in_progress'} />}
          onPress={row.payout.explorerUrl ? () => void Linking.openURL(row.payout.explorerUrl!) : undefined} />
      </Animated.View>)}
    </View> : <Empty title="No payouts yet" />)}

    {!loading && segment === 'Ledger' && (payables.length ? <View style={{ gap: 8 }}>
      {payables.map((row, index) => <Animated.View key={row.submissionId} entering={enter(index * 45, 360)}>
        <ListRow title={`${row.payableStatus === 'reversed' ? '-' : '+'}${money(row.amountAtomic)} USDC`}
          detail={`#${row.submissionId.slice(-6)}${times.get(row.submissionId) ? ` · ${when(times.get(row.submissionId)!)}` : ''}`}
          aside={<StatusPill status={row.payableStatus!} />} />
      </Animated.View>)}
    </View> : <Empty title="Nothing earned yet" />)}

    <Sheet open={manage} onClose={() => setManage(false)}>
      <Text style={s.sheetTitle}>Payout settings</Text>
      <View style={s.sheetCard}>
        {[['Network', 'Base Sepolia'], ['Token', 'Test USDC'], ['Account', 'Demo contributor'], ['Approval', 'Controller']].map(([k, v], i) =>
          <View key={k} style={[s.kv, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}>
            <Text style={t.body}>{k}</Text><Text style={t.bodyInk}>{v}</Text>
          </View>)}
      </View>
      <Button title="Close" onPress={() => setManage(false)} style={{ marginTop: 4 }} />
    </Sheet>
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  balance: { marginTop: 18, padding: 20, borderRadius: radius.card + 2, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, gap: 4 },
  balanceLabel: { fontFamily: f.medium, fontSize: 14, color: c.slate500 },
  amount: { fontFamily: f.medium, fontSize: 52, lineHeight: 60, letterSpacing: -1.6, color: c.ink, marginTop: 6, fontVariant: ['tabular-nums'] },
  paidRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
  paidLabel: { fontFamily: f.book, fontSize: 14, color: c.slate500 },
  paidValue: { fontFamily: f.medium, fontSize: 16, color: c.positive, fontVariant: ['tabular-nums'] },
  unavailable: { fontFamily: f.book, fontSize: 13, color: c.slate500, marginTop: 6 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, padding: 14, borderRadius: radius.card, backgroundColor: c.mist },
  pendingCount: { minWidth: 34, height: 34, paddingHorizontal: 8, borderRadius: 17, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  pendingNumber: { fontFamily: f.medium, fontSize: 15, color: c.paper },
  pendingText: { flex: 1, fontFamily: f.medium, fontSize: 15, color: c.ink },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  note: { fontFamily: f.book, fontSize: 12, color: c.slate500, textAlign: 'right', marginTop: 8, marginRight: 6 },
  skeleton: { height: 64, borderRadius: 18, backgroundColor: c.mist },
  sheetTitle: { fontFamily: f.medium, fontSize: 20, color: c.ink },
  sheetCard: { borderRadius: 18, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, paddingHorizontal: 16 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 },
});
