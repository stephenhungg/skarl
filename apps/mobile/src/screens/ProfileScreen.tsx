import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '../components/motion';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Crypto from 'expo-crypto';
import { colors as c, fonts as f, gutter, radius } from '../../theme';
import { identity, money } from '../api';
import { contributorStats, useContributorActivity } from '../data';
import { useSession } from '../session';
import { Button, H1, Pill } from '../components/Primitives';
import { ProfileIcon } from '../components/Icons';
import type { TabProps } from '../navigation';

function Stat({ value, label, index, tone }: { value: string; label: string; index: number; tone?: string }) {
  return <Animated.View entering={enter(120 + index * 60, 420)} style={s.stat}>
    <Text style={[s.statValue, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </Animated.View>;
}

export function ProfileScreen(_: TabProps<'Profile'>) {
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  const { earnings, submissions, loading } = useContributorActivity();
  const token = submissions[0]?.contributorTokenIdentifier ?? `demo:${identity.demoIdentity}`;
  const [shortId, setShortId] = useState('');
  useEffect(() => {
    let live = true;
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
      .then(hash => { if (live) setShortId(hash.slice(0, 6).toUpperCase()); }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  const stats = contributorStats(earnings.rows, submissions);
  const dash = loading ? '...' : null;

  return <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 120, paddingHorizontal: gutter }}>
    <Animated.View entering={FadeIn.duration(400)}><H1>Profile</H1></Animated.View>
    <Animated.View entering={enter(60, 420)} style={s.identity}>
      <View style={s.avatar}><ProfileIcon size={26} color={c.accentInk} /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.name}>Contributor #{shortId || '...'}</Text>
        <Text style={s.sub}>Demo identity</Text>
      </View>
      <Pill>Testnet</Pill>
    </Animated.View>
    <View style={s.grid}>
      <Stat index={0} value={dash ?? String(stats.uploads)} label="Total uploads" />
      <Stat index={1} value={dash ?? (earnings.error ? '0.00' : money(stats.earned))} label="Earned, test USDC" tone={stats.earned > 0n ? c.positive : undefined} />
      <Stat index={2} value={dash ?? String(stats.completed)} label="Tasks accepted" />
      <Stat index={3} value={dash ?? String(stats.days)} label="Days contributing" />
    </View>
    <Animated.View entering={enter(400, 420)} style={{ marginTop: 26 }}>
      <Button kind="secondary" title="Sign out" onPress={() => void signOut()} />
    </Animated.View>
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, padding: 16, borderRadius: radius.card,
    backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: f.medium, fontSize: 18, color: c.ink },
  sub: { fontFamily: f.book, fontSize: 14, color: c.slate500 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  stat: { width: '48.5%', flexGrow: 1, padding: 18, gap: 6, borderRadius: radius.card, backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, minHeight: 112, justifyContent: 'space-between' },
  statValue: { fontFamily: f.medium, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, color: c.ink },
  statLabel: { fontFamily: f.book, fontSize: 13, color: c.slate500 },
});
