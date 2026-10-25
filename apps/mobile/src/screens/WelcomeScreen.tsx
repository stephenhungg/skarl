import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '../components/motion';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors as c, fonts as f } from '../../theme';
import { Orbit } from '../components/Orbit';
import { Button } from '../components/Primitives';
import { ArrowRight } from '../components/Icons';
import { useSession } from '../session';
import type { RootProps } from '../navigation';

const rise = (step: number) => enter(700 + step * 110, 520);

export function WelcomeScreen({ navigation }: RootProps<'Welcome'>) {
  const { signIn } = useSession();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await signIn(); } finally { setBusy(false); } };
  const orbit = Math.min(width, height * 0.5);
  return <View style={[s.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
    <View style={s.top}><Orbit size={orbit} onPress={() => void go()} /></View>
    <View style={s.bottom}>
      <Animated.Text entering={rise(0)} accessibilityRole="header" style={s.title}>Welcome to Skarl</Animated.Text>
      <Animated.Text entering={rise(1)} style={s.body}>
        Skarl turns short task videos into earnings. Record tasks, get reviewed, get paid.
      </Animated.Text>
      <Animated.View entering={rise(2)} style={{ alignItems: 'center', marginTop: 22 }}>
        <Button kind="secondary" title="Log in with your email" icon={<ArrowRight />} onPress={() => navigation.navigate('Email')} style={s.email} />
      </Animated.View>
      <Animated.View entering={rise(3)} style={{ marginTop: 12 }}>
        <Button title="Let's earn" onPress={() => void go()} loading={busy} style={s.primary} />
        <Text style={s.demo}>Continues with a demo account on Base Sepolia testnet</Text>
      </Animated.View>
      <Animated.Text entering={rise(4)} style={s.legal}>
        By continuing, you agree to our <Text style={s.legalStrong}>Terms</Text> and <Text style={s.legalStrong}>Privacy Policy</Text>
      </Animated.Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bottom: { paddingHorizontal: 22 },
  title: { fontFamily: f.medium, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: c.ink, textAlign: 'center' },
  body: { fontFamily: f.book, fontSize: 16, lineHeight: 22, color: c.slate500, textAlign: 'center', marginTop: 10, paddingHorizontal: 8 },
  email: { minHeight: 46, paddingHorizontal: 20 },
  primary: { minHeight: 60 },
  demo: { fontFamily: f.book, fontSize: 12, lineHeight: 16, color: c.slate500, textAlign: 'center', marginTop: 10 },
  legal: { fontFamily: f.book, fontSize: 12, lineHeight: 17, color: c.slate300, textAlign: 'center', marginTop: 14 },
  legalStrong: { fontFamily: f.medium, color: c.slate700 },
});
