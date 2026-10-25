import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage,
  generateKeyPairSigner, getBase58Decoder, getBase64EncodedWireTransaction, partiallySignTransaction,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Instruction,
} from "@solana/kit";
import { SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT } from "@skarl/contracts/chain";
import { observeSolanaTransfer, parseSolanaFundingAuthorization, solanaUsdcAta, SOLANA_MEMO_PROGRAM,
  SOLANA_TOKEN_PROGRAM, type SolanaRpc } from "./solana.ts";

async function fixture(options: { mint?: string; destination?: string; memo?: string | null; amount?: bigint; signed?: boolean } = {}) {
  const [payer, fee, treasury] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  const destination = options.destination ?? await solanaUsdcAta(treasury.address);
  const mint = options.mint ?? SOLANA_USDC_MINT;
  const amount = options.amount ?? 1_000_000n;
  const data = new Uint8Array(10);
  data[0] = 12; data[9] = 6;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  const memo = options.memo === undefined ? "skarl:order-sol" : options.memo;
  const instructions: Instruction[] = [{ programAddress: SOLANA_TOKEN_PROGRAM, data,
    accounts: [
      { address: address(await solanaUsdcAta(payer.address)), role: AccountRole.WRITABLE },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(destination), role: AccountRole.WRITABLE },
      { address: payer.address, role: AccountRole.READONLY_SIGNER },
    ] }, ...(memo === null ? [] : [{ programAddress: SOLANA_MEMO_PROGRAM, data: new TextEncoder().encode(memo) }])];
  const message = appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(treasury.address), lastValidBlockHeight: 999n },
      setTransactionMessageFeePayer(fee.address, createTransactionMessage({ version: 0 }))));
  const unsigned = compileTransaction(message);
  const payerSigned = options.signed === false ? unsigned : await partiallySignTransaction([payer.keyPair], unsigned);
  const settled = await partiallySignTransaction([fee.keyPair], payerSigned);
  const signature = getBase58Decoder().decode(settled.signatures[fee.address]!);
  const terms = { treasuryAddress: treasury.address as string, amountAtomic: 1_000_000n, orderId: "order-sol" };
  const payload = { transaction: getBase64EncodedWireTransaction(payerSigned) };
  const parsed = {
    slot: 400, blockTime: 1_780_000_000, meta: { err: null as unknown, innerInstructions: [] },
    transaction: { signatures: [signature], message: {
      accountKeys: [{ pubkey: fee.address, signer: true }, { pubkey: payer.address, signer: true }],
      instructions: [
        { programId: SOLANA_TOKEN_PROGRAM as string, parsed: { type: "transferChecked", info: {
          mint, authority: payer.address, destination, tokenAmount: { amount: amount.toString(), decimals: 6 },
        } } },
        ...(memo === null ? [] : [{ programId: SOLANA_MEMO_PROGRAM as string, parsed: memo }]),
      ],
    } },
  };
  const status = { slot: 400, err: null as unknown, confirmations: 4 as number | null, confirmationStatus: "confirmed" };
  const raw = { slot: 400, meta: { err: null as unknown }, transaction: [getBase64EncodedWireTransaction(settled), "base64"] };
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: SolanaRpc = async <T>(method: string, params: unknown[]) => {
    calls.push({ method, params });
    const encoding = (params[1] as { encoding?: string } | undefined)?.encoding;
    if (method === "getGenesisHash") return SOLANA_PAYMENT_NETWORK.split(":")[1] as T;
    if (method === "getTransaction") return (encoding === "jsonParsed" ? parsed : raw) as T;
    if (method === "getSignatureStatuses") return { value: [status] } as T;
    if (method === "getBlock") return { blockhash: treasury.address } as T;
    throw new Error(`unexpected RPC ${method}`);
  };
  return { payload, terms, signature, parsed, raw, status, rpc, calls, settled, payer, fee };
}

async function observationFixture() {
  const f = await fixture();
  const auth = await parseSolanaFundingAuthorization(f.payload, f.terms);
  return { ...f, auth, expected: { fromAddress: auth.payerAddress, toAddress: f.terms.treasuryAddress,
    amountAtomic: f.terms.amountAtomic, orderId: f.terms.orderId, authorizationNonce: auth.authorizationNonce } };
}

test("Solana claim derives signer, exact terms and a message nonce unaffected by fee-payer signing", async () => {
  const f = await observationFixture();
  assert.equal(f.auth.payerAddress, f.payer.address);
  assert.equal(f.auth.recipientAddress, f.terms.treasuryAddress);
  assert.equal(f.auth.amountAtomic, 1_000_000n);
  assert.match(f.auth.authorizationNonce, /^0x[0-9a-f]{64}$/);
  const settledAuth = await parseSolanaFundingAuthorization({ transaction: getBase64EncodedWireTransaction(f.settled) }, f.terms);
  assert.equal(settledAuth.authorizationNonce, f.auth.authorizationNonce, "replayed message must claim the same nonce");
});

test("Solana claim binds the signed message fee payer to the supported quote", async () => {
  const f = await fixture();
  await parseSolanaFundingAuthorization(f.payload, { ...f.terms, feePayer: f.fee.address });
  await assert.rejects(parseSolanaFundingAuthorization(f.payload, { ...f.terms, feePayer: f.payer.address }), /wrong_solana_fee_payer/);
});

test("Solana parser rejects wrong mint, destination ATA, amount, memo and unsigned payer", async () => {
  for (const [options, error] of [
    [{ mint: "11111111111111111111111111111111" }, /wrong_token/],
    [{ destination: "11111111111111111111111111111111" }, /wrong_recipient_ata/],
    [{ amount: 1_000_001n }, /wrong_amount/],
    [{ memo: null }, /wrong_order_memo/],
    [{ memo: "skarl:other-order" }, /wrong_order_memo/],
    [{ signed: false }, /invalid_payer_signature/],
  ] as const) {
    const f = await fixture(options);
    await assert.rejects(parseSolanaFundingAuthorization(f.payload, f.terms), error);
  }
});

test("Solana RPC observation binds confirmed outer transfer and actual block to the original message", async () => {
  const f = await observationFixture();
  const observation = await observeSolanaTransfer(f.signature, f.expected, { rpc: f.rpc });
  assert.equal(observation.network, SOLANA_PAYMENT_NETWORK);
  assert.equal(observation.txHash, f.signature);
  assert.equal(observation.logIndex, 0);
  assert.equal(observation.blockNumber, 400n);
  assert.equal(observation.toAddress, f.terms.treasuryAddress);
  assert.equal(observation.tokenAddress, SOLANA_USDC_MINT);
  assert.equal(observation.observedAt, 1_780_000_000_000);
  assert.equal(observation.confirmations, 4);
  assert.ok(f.calls.some(call => call.method === "getTransaction" && (call.params[1] as { maxSupportedTransactionVersion: number }).maxSupportedTransactionVersion === 0));
});

test("RPC mismatched mint, destination, amount, signer and absent memo fail closed", async () => {
  const cases = ["mint", "destination", "amount", "signer", "memo"];
  for (const field of cases) {
    const f = await observationFixture();
    const info = (f.parsed.transaction.message.instructions[0]!.parsed as { info: { mint: string; destination: string; tokenAmount: { amount: string } } }).info;
    if (field === "mint") info.mint = "11111111111111111111111111111111";
    if (field === "destination") info.destination = f.terms.treasuryAddress;
    if (field === "amount") info.tokenAmount.amount = "1000001";
    if (field === "signer") f.parsed.transaction.message.accountKeys[1]!.signer = false;
    if (field === "memo") f.parsed.transaction.message.instructions.pop();
    await assert.rejects(observeSolanaTransfer(f.signature, f.expected, { rpc: f.rpc }),
      /wrong_token|wrong_recipient_ata|wrong_amount|wrong_sender|wrong_order_memo/);
  }
});

test("case-mutated Solana signature and payer cannot match a receipt", async () => {
  const f = await observationFixture();
  const altered = f.signature.replace(/[a-hj-km-zA-HJ-KM-Z]/, char => char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase());
  assert.notEqual(altered, f.signature);
  await assert.rejects(observeSolanaTransfer(altered, f.expected, { rpc: f.rpc }), /wrong_transaction_signature|invalid_solana_signature/);
  await assert.rejects(observeSolanaTransfer(f.signature, { ...f.expected, fromAddress: f.expected.fromAddress.toLowerCase() }, { rpc: f.rpc }), /wrong_sender/);
});

test("replayed receipt cannot satisfy a different signed message hash or order", async () => {
  const f = await observationFixture();
  await assert.rejects(observeSolanaTransfer(f.signature, { ...f.expected, authorizationNonce: `0x${"1".repeat(64)}` }, { rpc: f.rpc }), /authorization_not_in_receipt/);
  await assert.rejects(observeSolanaTransfer(f.signature, { ...f.expected, orderId: "other-order" }, { rpc: f.rpc }), /wrong_order_memo/);
});

test("failed, processed, one-confirmation or missing transactions never become observations", async () => {
  const failed = await observationFixture();
  failed.parsed.meta.err = { InstructionError: [0, "Custom"] };
  await assert.rejects(observeSolanaTransfer(failed.signature, failed.expected, { rpc: failed.rpc }), /receipt_failed/);
  for (const confirmationStatus of ["processed", "confirmed"]) {
    const f = await observationFixture();
    f.status.confirmationStatus = confirmationStatus; f.status.confirmations = 1;
    await assert.rejects(observeSolanaTransfer(f.signature, f.expected, { rpc: f.rpc }), /insufficient_confirmations/);
  }
  const f = await observationFixture();
  const missing: SolanaRpc = async <T>(method: string, params: unknown[]) => method === "getTransaction" ? null as T : f.rpc<T>(method, params);
  await assert.rejects(observeSolanaTransfer(f.signature, f.expected, { rpc: missing }), /solana_transaction_pending/);
});

test("wrong RPC network and signature/raw response mismatches fail closed", async () => {
  const f = await observationFixture();
  const wrongNetwork: SolanaRpc = async <T>(method: string, params: unknown[]) => method === "getGenesisHash" ? "wrong-network" as T : f.rpc<T>(method, params);
  await assert.rejects(observeSolanaTransfer(f.signature, f.expected, { rpc: wrongNetwork }), /wrong_rpc_network/);
  f.raw.slot++;
  await assert.rejects(observeSolanaTransfer(f.signature, f.expected, { rpc: f.rpc }), /invalid_block_identity/);
});
