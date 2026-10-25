import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadDraft, type Draft } from './upload';

const SESSION_KEY = 'skarl.session.v1';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type Session = {
  ready: boolean; signedIn: boolean; signedInAt: number | null;
  signIn(): Promise<void>; signOut(): Promise<void>;
  draft: Draft | null; setDraft(next: Draft | null): void; restoring: boolean; restoreError: string | null;
};
const SessionContext = createContext<Session | null>(null);

/** Demo sign in only remembers that this device chose the labeled demo contributor. */
export function SessionProvider({ children }: { children: ReactNode }) {
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

  const signIn = useCallback(async () => {
    const at = Date.now();
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ identity: 'contributor', signedInAt: at })).catch(() => {});
    setSignedInAt(at);
  }, []);
  // A saved take stays on the device after sign out, so an unresolved upload can still resume.
  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    setSignedInAt(null);
  }, []);

  const value = useMemo(() => ({ ready, signedIn: signedInAt !== null, signedInAt, signIn, signOut, draft, setDraft, restoring, restoreError }),
    [ready, signedInAt, signIn, signOut, draft, restoring, restoreError]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}
