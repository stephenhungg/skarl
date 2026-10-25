import { Component, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { authStorage } from './src/authStorage';
import { colors as c, fonts as f, gutter } from './theme';
import { SessionProvider, useSession } from './src/session';
import type { RootParamList } from './src/navigation';
import { Button } from './src/components/Primitives';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { TasksScreen } from './src/screens/TasksScreen';
import { TaskDetailScreen } from './src/screens/TaskDetailScreen';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SubmissionScreen } from './src/screens/SubmissionScreen';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const client = url && /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url) ? new ConvexReactClient(url) : null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

const Stack = createNativeStackNavigator<RootParamList>();
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.paper, card: c.paper, text: c.ink, border: c.hairline, primary: c.ink } };

function Root() {
  const { ready, signedIn, authenticated, contributorReady } = useSession();
  if (!ready) return <View style={s.center}><ActivityIndicator color={c.slate500} /></View>;
  if (authenticated && !contributorReady) return <SignInScreen />;
  return <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper }, animation: 'slide_from_right' }}>
    {!signedIn ? <>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
    </> : <>
      <Stack.Screen name="Tasks" component={TasksScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
      <Stack.Screen name="Submission" component={SubmissionScreen} />
      <Stack.Screen name="Capture" component={CaptureScreen}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false, contentStyle: { backgroundColor: c.night } }} />
    </>}
  </Stack.Navigator>;
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: message(error) }; }
  render() {
    return this.state.error ? <View style={[s.center, { padding: gutter, gap: 12 }]}>
      <Text style={s.title}>Can't reach Skarl</Text>
      <Text selectable style={s.body}>{this.state.error}</Text>
      <Button title="Retry" onPress={() => this.setState({ error: null })} style={{ alignSelf: 'stretch' }} />
    </View> : this.props.children;
  }
}

export default function App() {
  const [loaded, fontError] = useFonts({
    MontrealBook: require('./assets/fonts/montreal-book.otf'),
    MontrealRegular: require('./assets/fonts/montreal-regular.otf'),
    MontrealMedium: require('./assets/fonts/montreal-medium.otf'),
    Fono: require('./assets/fonts/fono.otf'),
  });
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.paper }}>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {!loaded && !fontError ? <View style={s.center}><ActivityIndicator color={c.slate500} /></View>
        : !client ? <View style={[s.center, { padding: gutter, gap: 8 }]}>
          <Text style={s.title}>Connect Skarl</Text>
          <Text style={s.body}>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env, then restart Expo.</Text>
        </View>
          : <ConvexAuthProvider client={client} storage={authStorage}><SessionProvider><Boundary>
            <NavigationContainer theme={theme}><Root /></NavigationContainer>
          </Boundary></SessionProvider></ConvexAuthProvider>}
    </SafeAreaProvider>
  </GestureHandlerRootView>;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.paper },
  title: { fontFamily: f.medium, fontSize: 22, color: c.ink, textAlign: 'center' },
  body: { fontFamily: f.book, fontSize: 15, lineHeight: 21, color: c.slate500, textAlign: 'center' },
});
