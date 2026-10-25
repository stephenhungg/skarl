import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '../components/motion';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors as c, fonts as f, gutter } from '../../theme';
import { Button, H1 } from '../components/Primitives';
import { ChevronLeft } from '../components/Icons';
import { PressableScale } from '../components/PressableScale';
import { useSession } from '../session';
import type { RootProps } from '../navigation';

export function EmailScreen({ navigation }: RootProps<'Email'>) {
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!tried) { setTried(true); return; }
    setBusy(true); try { await signIn(); } finally { setBusy(false); }
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
    <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={s.back}><ChevronLeft /></PressableScale>
    <Animated.View entering={enter(0, 420)} style={{ gap: 10, marginTop: 18 }}>
      <H1>Log in with email</H1>
      <Text style={s.body}>Enter your email to sign in.</Text>
    </Animated.View>
    <Animated.View entering={enter(80, 420)} style={{ marginTop: 26 }}>
      <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={c.fog}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        style={s.input} accessibilityLabel="Email" onSubmitEditing={() => void go()} returnKeyType="go" />
    </Animated.View>
    {tried && <Animated.View entering={FadeIn.duration(260)} style={s.note}>
      <Text style={s.noteText}>Email sign in is coming soon, continuing with the demo account.</Text>
    </Animated.View>}
    <View style={{ flex: 1 }} />
    <Button title={tried ? 'Continue with demo account' : 'Continue'} onPress={() => void go()} loading={busy}
      disabled={!tried && !/\S+@\S+\.\S+/.test(email)} style={{ minHeight: 60 }} />
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper, paddingHorizontal: gutter + 4 },
  back: { width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  body: { fontFamily: f.book, fontSize: 16, lineHeight: 22, color: c.slate500 },
  input: { height: 58, borderRadius: 18, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.card, paddingHorizontal: 18,
    fontFamily: f.book, fontSize: 17, color: c.ink },
  note: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: c.mist },
  noteText: { fontFamily: f.book, fontSize: 14, lineHeight: 19, color: c.slate700 },
});
