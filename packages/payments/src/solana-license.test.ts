import assert from "node:assert/strict";
import test from "node:test";
import { blockhash, generateKeyPairSigner, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { buildLicenseMintTransaction, licenseExtensions, type LicenseTokenTerms } from "./solana-license.ts";

const terms: LicenseTokenTerms = { name: "Skarl clip license", symbol: "SKARL", uri: "https://example.test/license/abc",
  fields: { manifest: "a".repeat(64), consent: "b".repeat(64) } };

async function build() {
  const [payer, holder, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  const built = await buildLicenseMintTransaction({ payer: payer.address, holder: holder.address, terms, lamports: 5_000_000n,
    blockhash: blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 100n, mint });
  const wire = getTransactionDecoder().decode(Buffer.from(built.transaction, "base64"));
  // Narrow the decoded v0 message to the fields these assertions read.
  const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes) as unknown as
    { staticAccounts: string[]; instructions: { programAddressIndex: number; data?: Uint8Array }[] };
  return { payer, mint, built, wire, message };
}

test("license mint is signed by the fresh mint key only; the custodial payer signs remotely", async () => {
  // CDP must be the only party able to complete the transaction, and the mint key must prove the new account.
  const { payer, mint, built, wire } = await build();
  assert.equal(built.mint, mint.address);
  assert.equal(wire.signatures[payer.address], null);
  assert.ok(wire.signatures[mint.address]);
  assert.equal(Buffer.from(built.transaction, "base64").length <= 1232, true);
});

test("license is a one-of-one Token-2022 mint whose minting authority is revoked in the same transaction", async () => {
  // Supply must be provably fixed at one: mint-to of 1 and SetAuthority(MintTokens -> None) are atomic with creation.
  const { message } = await build();
  const programs = message.instructions.map(ix => message.staticAccounts[ix.programAddressIndex]);
  assert.ok(programs.filter(program => program === TOKEN_2022_PROGRAM_ADDRESS).length >= 5 + Object.keys(terms.fields).length);
  const last = message.instructions.at(-1)!;
  assert.equal(message.staticAccounts[last.programAddressIndex], TOKEN_2022_PROGRAM_ADDRESS);
  assert.deepEqual([...last.data!.slice(0, 3)], [6, 0, 0]); // SetAuthority, MintTokens, no new authority
  const mintTo = message.instructions.at(-2)!;
  assert.equal(mintTo.data![0], 14); // MintToChecked
  assert.equal(new DataView(mintTo.data!.buffer, mintTo.data!.byteOffset).getBigUint64(1, true), 1n);
  assert.equal(mintTo.data![9], 0);
});

test("prefunded size covers the metadata that is realloc'd in after mint initialization", async () => {
  const { mint, payer } = await build();
  const sizes = licenseExtensions(mint.address, payer.address, terms);
  assert.ok(sizes.fundedSpace > sizes.initialSpace + 128 + 128);
});
