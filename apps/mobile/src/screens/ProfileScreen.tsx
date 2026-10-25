import { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Crypto from 'expo-crypto';
import { colors as c, fonts as f, gutter, radius } from '../../theme';
import { identity, money } from '../api';
import { contributorStats, IN_REVIEW, totals, useContributorActivity, when } from '../data';
import { useSession } from '../session';
import { Button, Empty, ListRow, StatusPill } from '../components/Primitives';
import { Segmented } from '../components/Segmented';
import { WalletCard } from '../components/WalletCard';
import { CountUp } from '../components/CountUp';
import { PressableScale } from '../components/PressableScale';
import { ChevronLeft, ChevronRight, LinkIcon, ProfileIcon } from '../components/Icons';
import { enter } from '../components/motion';
import type { RootProps } from '../navigation';

const SEGMENTS = ['Payouts', 'Submissions', 'Ledger'] as const;
type Segment = (typeof SEGMENTS)[number];

function Stat({ value, label, index }: { value: string; label: string; index: number }) {
  return <Animated.View entering={enter(160 + index * 50)} style={s.stat}>
    <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </Animated.View>;
}

export function ProfileScreen({ navigation, route }: RootProps<'Profile'>) {
  const insets = useSafeAreaInsets();
  const { signOut, draft, authenticated, email, userId } = useSession();
  const { earnings, submissions, loading, error } = useContributorActivity();
  const [signOutError, setSignOutError] = useState('');
  const leave = async () => { try { await signOut(); } catch { setSignOutError('Could not sign out. Please try again.'); } };
  const [segment, setSegment] = useState<Segment>('Submissions');
  useEffect(() => { if (route.params?.segment) setSegment(route.params.segment); }, [route.params?.segment]);

  const token = submissions[0]?.contributorTokenIdentifier ?? (authenticated ? `auth:${userId}` : `demo:${identity.demoIdentity}`);
  const [shortId, setShortId] = useState('');
  useEffect(() => {
    let live = true;
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
      .then(hash => { if (live) setShortId(hash.slice(0, 6).toUpperCase()); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const sum = totals(earnings.rows);
  const stats = contributorStats(earnings.rows, submissions);
  const times = useMemo(() => new Map(submissions.map(row => [row._id, row._creationTime])), [submissions]);
  const payables = useMemo(() => (earnings.rows ?? []).filter(row => row.payableStatus)
    .sort((a, b) => (times.get(b.submissionId) ?? 0) - (times.get(a.submissionId) ?? 0)), [earnings.rows, times]);
  const payouts = payables.filter(row => row.payout.status === 'paid' || row.payableStatus === 'payout_in_progress');
  const unsent = draft && !draft.submissionId ? 1 : 0;
  const pending = submissions.filter(row => IN_REVIEW.includes(row.status)).length + unsent;
  const dash = loading ? '...' : null;

  return <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, paddingHorizontal: gutter }}>
    <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={s.back}><ChevronLeft /></PressableScale>
    <Animated.View entering={FadeIn.duration(360)} style={s.identity}>
      <View style={s.avatar}><ProfileIcon size={24} color={c.accentInk} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.name}>Contributor #{shortId || '...'}</Text>
        <Text style={s.sub}>{authenticated ? email ?? 'Google account' : 'Demo identity'}</Text>
      </View>
    </Animated.View>

    <Animated.View entering={enter(60)} style={s.balance}>
      <View style={s.balanceTop}>
        <Text style={s.balanceLabel}>Balance</Text>
        <Text style={s.unit}>USDC</Text>
      </View>
      {earnings.error ? <Text style={s.amount}>0.00</Text> : <CountUp atomic={sum.pending + sum.paid} style={s.amount} />}
      <View style={s.split}>
        <Text style={s.splitText}>Pending <Text style={s.splitValue}>{money(sum.pending)}</Text></Text>
        <Text style={s.splitText}>Paid <Text style={[s.splitValue, sum.paid > 0n && { color: c.positive }]}>{money(sum.paid)}</Text></Text>
      </View>
      <PressableScale accessibilityRole="button" onPress={() => unsent ? navigation.navigate('Capture', { consented: true }) : setSegment('Submissions')} style={s.pending}>
        <View style={s.pendingCount}><Text style={s.pendingNumber}>{pending}</Text></View>
        <Text style={s.pendingText}>Pending {pending === 1 ? 'upload' : 'uploads'}</Text>
        <ChevronRight />
      </PressableScale>
    </Animated.View>

    <WalletCard />

    <View style={s.grid}>
      <Stat index={0} value={dash ?? String(stats.uploads)} label="Uploads" />
      <Stat index={1} value={dash ?? (earnings.error ? '0.00' : money(stats.earned))} label="Earned" />
      <Stat index={2} value={dash ?? String(stats.completed)} label="Accepted" />
      <Stat index={3} value={dash ?? String(stats.days)} label="Days active" />
    </View>

    <View style={{ marginTop: 22, marginBottom: 12 }}>
      <Segmented<Segment> options={SEGMENTS} value={segment} onChange={setSegment} />
    </View>

    {loading && <View style={{ gap: 8 }}>{[0, 1, 2].map(i => <View key={i} style={s.skeleton} />)}</View>}

    {!loading && segment === 'Submissions' && (submissions.length ? <View style={{ gap: 8 }}>
      {submissions.map((row, index) => <Animated.View key={row._id} entering={enter(Math.min(index, 8) * 40, 320)}>
        <ListRow title={`Take ${row._id.slice(-5).toUpperCase()}`} detail={`${when(row._creationTime)}${row.verificationOnly ? ' · Test' : ''}`}
          aside={<StatusPill status={row.status} />} onPress={() => navigation.navigate('Submission', { submissionId: row._id })} />
      </Animated.View>)}
    </View> : <Empty title={error ? 'Could not load' : 'No submissions yet'} />)}

    {!loading && segment === 'Payouts' && (payouts.length ? <View style={{ gap: 8 }}>
      {payouts.map((row, index) => <Animated.View key={row.submissionId} entering={enter(index * 40, 320)}>
        <ListRow title={`${money(row.payout.amountAtomic ?? row.amountAtomic)} USDC`} detail={row.payout.txHash ? `${row.payout.txHash.slice(0, 10)}...` : 'In progress'}
          aside={row.payout.explorerUrl ? <LinkIcon /> : <StatusPill status={row.payout.status === 'paid' ? 'paid' : 'payout_in_progress'} />}
          onPress={row.payout.explorerUrl ? () => void Linking.openURL(row.payout.explorerUrl!) : undefined} />
      </Animated.View>)}
    </View> : <Empty title="No payouts yet" />)}

    {!loading && segment === 'Ledger' && (payables.length ? <View style={{ gap: 8 }}>
      {payables.map((row, index) => <Animated.View key={row.submissionId} entering={enter(index * 40, 320)}>
        <ListRow title={`${row.payableStatus === 'reversed' ? '-' : '+'}${money(row.amountAtomic)} USDC`}
          detail={`Take ${row.submissionId.slice(-5).toUpperCase()}${times.get(row.submissionId) ? ` · ${when(times.get(row.submissionId)!)}` : ''}`}
          aside={<StatusPill status={row.payableStatus!} />} />
      </Animated.View>)}
    </View> : <Empty title="Nothing earned yet" />)}

    {signOutError ? <Text accessibilityRole="alert" style={s.sub}>{signOutError}</Text> : null}
    <Button kind="secondary" title="Sign out" onPress={() => void leave()} style={{ marginTop: 28 }} />
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: f.medium, fontSize: 20, letterSpacing: -0.3, color: c.ink },
  sub: { fontFamily: f.book, fontSize: 13, color: c.slate500 },
  balance: { marginTop: 18, padding: 20, paddingBottom: 12, borderRadius: radius.card + 2, backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  balanceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { fontFamily: f.medium, fontSize: 14, color: c.slate500 },
  unit: { fontFamily: f.mono, fontSize: 11, letterSpacing: 0.6, color: c.slate500, textTransform: 'uppercase' },
  amount: { fontFamily: f.medium, fontSize: 52, lineHeight: 60, letterSpacing: -1.6, color: c.ink, marginTop: 6, fontVariant: ['tabular-nums'] },
  split: { flexDirection: 'row', gap: 18, marginTop: 4 },
  splitText: { fontFamily: f.book, fontSize: 14, color: c.slate500 },
  splitValue: { fontFamily: f.medium, color: c.ink },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
  pendingCount: { minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, backgroundColor: c.mist, alignItems: 'center', justifyContent: 'center' },
  pendingNumber: { fontFamily: f.medium, fontSize: 14, color: c.ink },
  pendingText: { flex: 1, fontFamily: f.medium, fontSize: 15, color: c.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  stat: { width: '48%', flexGrow: 1, padding: 16, gap: 4, borderRadius: radius.card, backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  statValue: { fontFamily: f.medium, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, color: c.ink },
  statLabel: { fontFamily: f.book, fontSize: 13, color: c.slate500 },
  skeleton: { height: 64, borderRadius: 18, backgroundColor: c.mist },
});
