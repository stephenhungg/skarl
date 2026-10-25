import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@convex-dev/auth/react';

// Access tokens, refresh tokens and the OAuth verifier belong in the OS keychain.
// AsyncStorage is reserved for the unsigned demo preference and local drafts.
export const authStorage: TokenStorage = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: key => SecureStore.deleteItemAsync(key),
};
