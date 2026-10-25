import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { makeFunctionReference } from 'convex/server';
import { identity } from './api';
import { bytesToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const KEY = 'skarl.wallet.v1';

export type MyWallet = { tokenIdentifier: string; walletAddress: string | null; verifiedAt: number | null };
type Challenge = { message: string; nonce: string; expiresAt: number; walletAddress: string; chainId: number };
type Verified = { verified: true; walletAddress: string; verifiedAt: number };

export const walletApi = {
  mine: makeFunctionReference<'query', { demoIdentity: string }, MyWallet>('contributorWallet:mine'),
  challenge: makeFunctionReference<'mutation', ChallengeArgs, Challenge>('contributorWallet:challenge'),
  verify: makeFunctionReference<'mutation', VerifyArgs, Verified>('contributorWallet:verify'),
};

/** The device address, if this phone already holds a key. */
export async function deviceAddress() {
  const key = await SecureStore.getItemAsync(KEY).catch(() => null);
  return key ? privateKeyToAccount(key as Hex).address : null;
}

async function deviceAccount() {
  let key = await SecureStore.getItemAsync(KEY) as Hex | null;
  if (!key) {
    key = bytesToHex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(KEY, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }
  return privateKeyToAccount(key);
}

type ChallengeArgs = { demoIdentity: string; contributorTokenIdentifier: string; walletAddress: string };
type VerifyArgs = { demoIdentity: string; contributorTokenIdentifier: string; nonce: string; signature: string };

/** Creates (or reuses) this device's key, then proves ownership with the server's one-use SIWE message. */
export async function createWallet(tokenIdentifier: string,
  challenge: (args: ChallengeArgs) => Promise<Challenge>, verify: (args: VerifyArgs) => Promise<Verified>) {
  const account = await deviceAccount();
  const issued = await challenge({ ...identity, contributorTokenIdentifier: tokenIdentifier, walletAddress: account.address });
  const signature = await account.signMessage({ message: issued.message });
  return verify({ ...identity, contributorTokenIdentifier: tokenIdentifier, nonce: issued.nonce, signature });
}

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
