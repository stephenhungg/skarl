import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { makeRedirectUri } from 'expo-auth-session';
import { openAuthSessionAsync } from 'expo-web-browser';
import { api } from './api';
import { contributorIdentity } from './auth/identity';
import { googleSignIn } from './oauth';
import { loadDraft, type Draft } from './upload';

const SESSION_KEY = 'skarl.session.v1';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type Session = {
  ready: boolean; signedIn: boolean; signedInAt: number | null;
  authenticated: boolean; contributorReady: boolean; email: string | null; userId: string | null; demoMode: boolean;
  signIn(): Promise<void>; signInGoogle(): Promise<boolean>; claimContributor(): Promise<void>; signOut(): Promise<void>;
  draft: Draft | null; setDraft(next: Draft | null): void; restoring: boolean; restoreError: string | null;
};
const SessionContext = createContext<Session | null>(null);

/** Real auth always takes precedence over the unsigned demo preference. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { signIn: authenticate, signOut: endAuth } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me, isLoading ? 'skip' : {});
  const claim = useMutation(api.claimContributor);
  const [ready, setReady] = useState(false);
  const [signedInAt, setSignedInAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(SESSION_KEY)
      .then(value => { if (mounted && value) setSignedInAt(Number(JSON.parse(value).signedInAt) || Date.now()); })
      .catch(() => {})
      .finally(() => { if (mounted) setReady(true); });
    loadDraft().then(value => { if (mounted) setDraft(value); })
      .catch(error => { if (mounted) setRestoreError(`Could not restore saved contribution: ${message(error)}`); })
      .finally(() => { if (mounted) setRestoring(false); });
    return () => { mounted = false; };
  }, []);

  // Once this device uses real auth, losing that session must return to sign-in.
  // A previously selected demo preference must never silently restore demo access.
  useEffect(() => {
    if (isAuthenticated && ready) {
      setSignedInAt(null);
      void AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    }
  }, [isAuthenticated, ready]);

  const signIn = useCallback(async () => {
    if (isAuthenticated || isLoading || !me?.demoMode) throw new Error('Demo entry is unavailable for this session.');
    const at = Date.now();
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ identity: contributorIdentity.demoIdentity, signedInAt: at })).catch(() => {});
    setSignedInAt(at);
  }, [isAuthenticated, isLoading, me?.demoMode]);
  const signInGoogle = useCallback(() => googleSignIn(authenticate,
    makeRedirectUri({ scheme: 'skarl', path: 'auth' }), openAuthSessionAsync), [authenticate]);
  const claimContributor = useCallback(async () => { await claim({ role: 'contributor' }); }, [claim]);
  // A saved take stays on the device after sign out, so an unresolved upload can still resume.
  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    setSignedInAt(null);
    if (isAuthenticated) await endAuth();
  }, [isAuthenticated, endAuth]);

  const value = useMemo(() => ({
    ready: ready && !isLoading && me !== undefined,
    signedIn: isAuthenticated || (signedInAt !== null && me?.demoMode === true), signedInAt,
    authenticated: isAuthenticated, contributorReady: isAuthenticated && !!me?.roles.includes('contributor'),
    email: isAuthenticated ? me?.email ?? null : null, userId: isAuthenticated ? me?.userId ?? null : null,
    demoMode: me?.demoMode === true, signIn, signInGoogle, claimContributor, signOut,
    draft, setDraft, restoring, restoreError,
  }), [ready, isLoading, me, isAuthenticated, signedInAt, signIn, signInGoogle, claimContributor, signOut, draft, restoring, restoreError]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}
