import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as c, fonts as f, gutter } from '../../theme';
import { Button, H1 } from '../components/Primitives';
import { useSession } from '../session';

export function SignInScreen() {
  const { authenticated, email, signInGoogle, claimContributor, signOut, signIn, demoMode } = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); }
    finally { setBusy(false); }
  };
  return <View style={[s.screen, { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 20) }]}>
    <H1>{authenticated ? 'Make it yours.' : 'Welcome to Skarl'}</H1>
    <Text style={s.body}>{authenticated
      ? `You're signed in${email ? ` as ${email}` : ''}. Choose to contribute with your own account. Roles are checked by the server.`
      : 'Sign in to record tasks, get reviewed and track your earnings.'}</Text>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View style={{ flex: 1 }} />
    <Button title={authenticated ? 'Continue as a contributor' : 'Continue with Google'}
      onPress={() => void run(authenticated ? claimContributor : signInGoogle)} loading={busy} />
    {authenticated ? <Button kind="secondary" title="Sign out" disabled={busy} onPress={() => void run(signOut)} style={{ marginTop: 12 }} />
      : demoMode ? <>
        <Button kind="secondary" title="Continue with demo account" disabled={busy} onPress={() => void run(signIn)} style={{ marginTop: 12 }} />
        <Text style={s.demo}>Unsigned demo identity · Base Sepolia testnet</Text>
      </> : null}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper, paddingHorizontal: gutter + 4, gap: 16 },
  body: { fontFamily: f.book, fontSize: 16, lineHeight: 23, color: c.slate500 },
  error: { fontFamily: f.book, fontSize: 14, lineHeight: 20, color: c.ink, backgroundColor: c.mist, padding: 14, borderRadius: 12 },
  demo: { fontFamily: f.book, fontSize: 12, lineHeight: 18, color: c.slate500, textAlign: 'center' },
});
