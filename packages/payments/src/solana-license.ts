import {
  AccountRole, address, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage,
  generateKeyPairSigner, getAddressEncoder, getBase64EncodedWireTransaction, getU32Encoder, getU64Encoder, partiallySignTransaction,
  pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, some,
  type AccountSignerMeta, type Address, type Blockhash, type Instruction, type KeyPairSigner, type TransactionSigner,
} from "@solana/kit";
import {
  AuthorityType, extension, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getInitializeMint2Instruction,
  getMintSize, getMintToCheckedInstruction, getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions, getSetAuthorityInstruction, getUpdateTokenMetadataFieldInstruction, TOKEN_2022_PROGRAM_ADDRESS, tokenMetadataField,
} from "@solana-program/token-2022";

import type { SolanaRpc } from "./solana.ts";

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/** One Skarl clip license: a Token-2022 mint with on-chain metadata, supply 1, decimals 0. */
export interface LicenseTokenTerms {
  name: string;
  symbol: string;
  uri: string;
  /** Hashes binding the token to the off-chain license, consent receipt and delivered manifest. */
  fields: Record<string, string>;
}

export function licenseExtensions(mint: Address, authority: Address, terms: LicenseTokenTerms) {
  const pointer = extension("MetadataPointer", { authority: some(authority), metadataAddress: some(mint) });
  const metadata = extension("TokenMetadata", { updateAuthority: some(authority), mint, name: terms.name, symbol: terms.symbol,
    uri: terms.uri, additionalMetadata: new Map(Object.entries(terms.fields)) });
  // The account is created with room for the pointer only; metadata initialization reallocs into the prefunded lamports.
  return { pointer, metadata, initialSpace: getMintSize([pointer]), fundedSpace: getMintSize([pointer, metadata]) };
}

function createAccountInstruction(payer: TransactionSigner, account: TransactionSigner, lamports: bigint, space: number, owner: Address): Instruction {
  const data = new Uint8Array(52);
  data.set(getU32Encoder().encode(0), 0); // SystemInstruction::CreateAccount
  data.set(getU64Encoder().encode(lamports), 4);
  data.set(getU64Encoder().encode(BigInt(space)), 12);
  data.set(getAddressEncoder().encode(owner), 20);
  const accounts: AccountSignerMeta[] = [
    { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
    { address: account.address, role: AccountRole.WRITABLE_SIGNER, signer: account },
  ];
  return { programAddress: SYSTEM_PROGRAM, data, accounts };
}

/** Creates the mint, writes metadata, mints exactly one token to the holder, then permanently revokes minting. */
export async function licenseMintInstructions(input: { payer: TransactionSigner; mint: TransactionSigner; holder: Address;
  terms: LicenseTokenTerms; lamports: bigint }): Promise<Instruction[]> {
  const { payer, mint } = input;
  const { pointer, metadata, initialSpace } = licenseExtensions(mint.address, payer.address, input.terms);
  const [ata] = await findAssociatedTokenPda({ owner: input.holder, mint: mint.address, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return [
    createAccountInstruction(payer, mint, input.lamports, initialSpace, TOKEN_2022_PROGRAM_ADDRESS),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, [pointer]),
    getInitializeMint2Instruction({ mint: mint.address, decimals: 0, mintAuthority: payer.address, freezeAuthority: null }),
    ...getPostInitializeInstructionsForMintExtensions(mint.address, payer, [metadata]),
    // The initializer writes name/symbol/uri only; each additional field is its own update.
    ...Object.entries(input.terms.fields).map(([key, value]) => getUpdateTokenMetadataFieldInstruction({
      metadata: mint.address, updateAuthority: payer, field: tokenMetadataField("Key", [key]), value })),
    getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: input.holder, mint: mint.address, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
    getMintToCheckedInstruction({ mint: mint.address, token: ata, mintAuthority: payer, amount: 1n, decimals: 0 }),
    getSetAuthorityInstruction({ owned: mint.address, owner: payer, authorityType: AuthorityType.MintTokens, newAuthority: null }),
  ];
}

/** Builds the wire transaction signed by the fresh mint key only; the custodial payer signs remotely (CDP). */
export async function buildLicenseMintTransaction(input: { payer: Address; holder: Address; terms: LicenseTokenTerms;
  lamports: bigint; blockhash: Blockhash; lastValidBlockHeight: bigint; mint?: KeyPairSigner }) {
  const mint = input.mint ?? await generateKeyPairSigner();
  const payer = createNoopSigner(input.payer);
  const instructions = await licenseMintInstructions({ payer, mint, holder: input.holder, terms: input.terms, lamports: input.lamports });
  const message = pipe(createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(payer, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash({ blockhash: input.blockhash, lastValidBlockHeight: input.lastValidBlockHeight }, tx),
    tx => appendTransactionMessageInstructions(instructions, tx));
  const signed = await partiallySignTransaction([mint.keyPair], compileTransaction(message));
  return { mint: mint.address, transaction: getBase64EncodedWireTransaction(signed) };
}

/** The two CDP Solana calls the license minter needs; satisfied by `new CdpClient().solana`. */
export interface CdpSolanaSigner {
  getOrCreateAccount(options: { name: string }): Promise<{ address: string }>;
  signTransaction(options: { address: string; transaction: string; idempotencyKey?: string }): Promise<{ signedTransaction: string }>;
}

export class LicenseMintError extends Error {}

/** Mints one license token with the named CDP Solana account as payer, metadata/update authority and custodial holder. */
export async function mintLicenseWithCdp(input: { solana: CdpSolanaSigner; accountName: string; terms: LicenseTokenTerms;
  rpc: SolanaRpc; holder?: string; idempotencyKey?: string; confirmTimeoutMs?: number }) {
  const account = await input.solana.getOrCreateAccount({ name: input.accountName });
  const payer = address(account.address);
  const holder = address(input.holder ?? account.address);
  const { fundedSpace } = licenseExtensions(payer, payer, input.terms); // size does not depend on the mint address
  const [rent, latest, balance] = await Promise.all([
    input.rpc<number>("getMinimumBalanceForRentExemption", [fundedSpace]),
    input.rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]),
    input.rpc<{ value: number }>("getBalance", [account.address, { commitment: "confirmed" }]),
  ]);
  // Mint rent + holder token account rent + fees; fail before signing instead of burning a blockhash on-chain.
  const needed = BigInt(rent) + 2_500_000n;
  if (BigInt(balance.value) < needed) throw new LicenseMintError(`license_signer_underfunded:${account.address}`);
  const built = await buildLicenseMintTransaction({ payer, holder, terms: input.terms, lamports: BigInt(rent),
    blockhash: latest.value.blockhash as Blockhash, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) });
  const { signedTransaction } = await input.solana.signTransaction({ address: account.address, transaction: built.transaction,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  const signature = await input.rpc<string>("sendTransaction", [signedTransaction, { encoding: "base64", preflightCommitment: "confirmed" }]);
  const deadline = Date.now() + (input.confirmTimeoutMs ?? 45_000);
  while (Date.now() < deadline) {
    const status = await input.rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[signature]]);
    const row = status.value[0];
    if (row?.err) throw new LicenseMintError(`license_mint_failed:${JSON.stringify(row.err).slice(0, 120)}`);
    if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") {
      return { mint: built.mint, signature, payer: account.address, holder, rentLamports: rent };
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return { mint: built.mint, signature, payer: account.address, holder, rentLamports: rent, unconfirmed: true as const };
}
