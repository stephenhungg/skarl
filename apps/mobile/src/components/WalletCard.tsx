import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated from 'react-native-reanimated';
import { useConvex, useMutation } from 'convex/react';
import { colors as c, fonts as f, radius } from '../../theme';
import { identity } from '../api';
import { createWallet, short, walletApi, type MyWallet } from '../wallet';
import { Button } from './Primitives';
import { PressableScale } from './PressableScale';
import { WalletIcon } from './Icons';
import { enter } from './motion';

// Fetched outside render: until the backend ships this query the card simply stays hidden.
export function WalletCard() {
  const convex = useConvex();
  const [mine, setMine] = useState<MyWallet | null>(null);
  const load = useCallback(() => convex.query(walletApi.mine, identity).then(setMine, () => setMine(null)), [convex]);
  useEffect(() => { void load(); }, [load]);
  const challenge = useMutation(walletApi.challenge);
  const verify = useMutation(walletApi.verify);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (!mine) return;
    setBusy(true);
    setFailed(false);
    try {
      await createWallet(mine.tokenIdentifier, challenge, verify);
      await load();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  async function copy(address: string) {
    await Clipboard.setStringAsync(address);
    void Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  if (!mine) return null;
  const address = mine.walletAddress;
  return <Animated.View entering={enter(100)} style={s.card}>
    <View style={s.icon}><WalletIcon size={20} /></View>
    {address ? <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.label}>Payout wallet</Text>
        <Text style={s.address}>{short(address)}</Text>
      </View>
      <PressableScale accessibilityRole="button" accessibilityLabel="Copy wallet address" onPress={() => void copy(address)} style={s.copy}>
        <Text style={s.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
      </PressableScale>
    </> : <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.label}>{failed ? 'Couldn’t create wallet' : 'Payout wallet'}</Text>
        <Text style={s.sub}>{failed ? 'Try again' : 'USDC on Base'}</Text>
      </View>
      <Button title={failed ? 'Retry' : 'Create'} loading={busy} disabled={busy} onPress={() => void create()} style={s.create} />
    </>}
  </Animated.View>;
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, padding: 14, borderRadius: radius.card,
    backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.mist },
  label: { fontFamily: f.medium, fontSize: 15, color: c.ink },
  address: { fontFamily: f.mono, fontSize: 13, color: c.slate500 },
  sub: { fontFamily: f.book, fontSize: 13, color: c.slate500 },
  copy: { height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.mist },
  copyText: { fontFamily: f.medium, fontSize: 13, color: c.ink },
  create: { height: 38, paddingHorizontal: 18 },
});
