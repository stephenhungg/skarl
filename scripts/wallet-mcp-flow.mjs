#!/usr/bin/env node
/** Non-signing Wallet MCP coordinator. Tools and human approval remain in the connected agent. */
import { constants, openSync, closeSync, fchmodSync, readFileSync, fstatSync, writeFileSync, fsyncSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, parseAbi, parseEventLogs } from "viem";
import { baseSepolia } from "viem/chains";
import { PAYMENT_NETWORK, PAYMENT_CHAIN_ID, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";
import { parseAtomicUsdc } from "../packages/contracts/src/index.ts";
import { fundingTermsHash } from "../packages/payments/src/funding-terms.ts";
import { prepareWalletMcpFunding } from "../packages/payments/src/wallet-mcp.ts";
import { validateTransfer } from "../packages/payments/src/reconciliation.ts";

export class WalletFlowError extends Error {}
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
const hash = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const requestId = value => typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
const PHASES = ["preparing", "initiation_started", "awaiting_approval", "approved", "completion_started", "completion_reported", "confirmed", "already_funded"];
const fail = message => { throw new WalletFlowError(message); };
const eventAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export function readPrivateJson(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fchmodSync(fd, 0o600);
    if (fstatSync(fd).size > 262144) fail("Local result/state exceeds the supported size.");
    const source = readFileSync(fd, "utf8");
    if (Buffer.byteLength(source) > 262144) fail("Local result/state exceeds the supported size.");
    return JSON.parse(source);
  } finally { closeSync(fd); }
}
export function writePrivateJson(file, value, exclusive = false) {
  mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
  const target = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (!exclusive) { try { renameSync(target, file); } catch (error) { unlinkSync(target); throw error; } }
}
function fundingUrl(origin, orderId) {
  if (typeof origin !== "string" || !origin.trim()) fail("Supply a pinned --origin or SKARL_APP_URL using HTTPS.");
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash ||
    !/^[A-Za-z0-9_-]+$/.test(orderId)) fail("Use a pinned HTTPS origin and an order document ID.");
  return new URL(`/api/orders/${orderId}/fund`, base).href;
}
function positive(value) { try { return parseAtomicUsdc(value) > 0n; } catch { return false; } }
function validState(state) {
  if (!record(state) || state.version !== 1 || !PHASES.includes(state.phase) || !Number.isSafeInteger(state.createdAt) ||
    typeof state.resource !== "string" || typeof state.orderId !== "string" || fundingUrl(new URL(state.resource).origin, state.orderId) !== state.resource ||
    !positive(state.maxPaymentAtomic) || !address.test(state.expectedPayTo) || !address.test(state.payerAddress) ||
    state.expectedPayTo.toLowerCase() === state.payerAddress.toLowerCase() ||
    (state.requestId !== undefined && !requestId(state.requestId))) fail("Invalid or changed wallet-flow state.");
  if (state.phase !== "preparing" && state.phase !== "already_funded") {
    const planned = prepareWalletMcpFunding(state);
    if (state.status.fundingTermsHash !== fundingTermsHash({orderId:state.orderId,amountAtomic:state.status.amountAtomic,payTo:state.expectedPayTo,autoPay:state.status.autoPay})) fail("Stored funding terms commitment changed.");
    if (!record(state.request) || JSON.stringify(planned) !== JSON.stringify(state.request) ||
      typeof state.idempotencyKey !== "string" || !/^skarl-wallet-[A-Za-z0-9-]+$/.test(state.idempotencyKey)) fail("Wallet-flow quote/request binding changed.");
  }
  if (["awaiting_approval", "approved", "completion_started", "completion_reported"].includes(state.phase) &&
    (!requestId(state.requestId) || !Number.isSafeInteger(state.firstCompletionBy))) fail("Original MCP request metadata is required.");
  return state;
}
const readState = file => validState(readPrivateJson(file));

async function publicResponse(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (response.redirected || (response.url && response.url !== url)) fail("Funding probe changed its pinned resource.");
  const bytes = [], reader = response.body?.getReader(); let size = 0;
  if (reader) while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > 262144) { await reader.cancel(); fail("Funding response exceeds the supported size."); }
    bytes.push(part.value);
  }
  let body; try { body = JSON.parse(Buffer.concat(bytes).toString("utf8")); } catch { body = null; }
  return { response, body };
}

export async function prepareFlow(input, { fetchImpl = fetch, now = Date.now } = {}) {
  const resource = fundingUrl(input.origin ?? process.env.SKARL_APP_URL, input.orderId);
  const state = { version: 1, phase: "preparing", createdAt: now(), resource, orderId: input.orderId,
    maxPaymentAtomic: input.maxPaymentAtomic, expectedPayTo: input.expectedPayTo, payerAddress: input.payerAddress };
  validState(state);
  // Reserve before network/tool work. A repeated invocation cannot overwrite an unknown outcome.
  writePrivateJson(input.stateFile, state, true);
  const statusRead = await publicResponse(resource, {}, fetchImpl);
  if (statusRead.response.status !== 200 || !record(statusRead.body)) fail(`Funding status unavailable (HTTP ${statusRead.response.status}); no MCP tool was called.`);
  if (statusRead.body.fundingStatus === "confirmed") {
    state.phase = "already_funded"; writePrivateJson(input.stateFile, state);
    return { status: "already_funded", message: "No initiation is needed. Existing funding is not a new Wallet MCP payment." };
  }
  if (statusRead.body.fundingStatus !== "awaiting_payment" || statusRead.body.attemptId !== null || statusRead.body.txHash !== null) fail("An existing or unknown funding attempt must be reconciled; no new initiation is allowed.");
  const rule = statusRead.body.autoPay;
  if (!record(rule) || typeof rule.enabled !== "boolean" || rule.requireAllChecks !== true || !positive(rule.maxPerClipAtomic)) fail("Stored auto-pay rule is unavailable or invalid. Verify the current deployment and buyer terms before funding.");
  const commitment = fundingTermsHash({ orderId: state.orderId, amountAtomic: statusRead.body.amountAtomic, payTo: state.expectedPayTo, autoPay: rule });
  if (statusRead.body.fundingTermsHash !== commitment) fail("Funding terms commitment is missing or changed; deploy the updated endpoint and review the buyer rule before funding.");
  const probe = await publicResponse(resource, { method: "POST", headers: { "X-Skarl-Funding-Terms": commitment } }, fetchImpl);
  if (probe.response.status !== 402) fail(`No fresh payment challenge (HTTP ${probe.response.status}); inspect the original funding attempt without paying again.`);
  const encoded = probe.response.headers.get("PAYMENT-REQUIRED");
  if (!encoded || encoded.length > 262144) fail("Missing or oversized PAYMENT-REQUIRED challenge.");
  let challenge; try { challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { fail("Invalid payment challenge."); }
  Object.assign(state, { status: statusRead.body, challenge });
  state.request = prepareWalletMcpFunding(state);
  state.idempotencyKey = `skarl-wallet-${randomUUID()}`;
  state.phase = "initiation_started";
  writePrivateJson(input.stateFile, state);
  return { status: state.phase, stateFile: resolve(input.stateFile), autoPay: state.status.autoPay ?? null,
    note: "Review the stored buyer rule as well as the funding cap. Call this actual Wallet MCP tool once; human approval remains required. Record its original requestId. No MCP tool or transfer was executed by this script.",
    ...state.request, arguments: { ...state.request.arguments, headers: { "Idempotency-Key": state.idempotencyKey, "X-Skarl-Funding-Terms": state.status.fundingTermsHash } } };
}

export function recordFlow(file, step, result, now = Date.now()) {
  const state = readState(file);
  if (!record(result) || !requestId(result.requestId)) fail("Supply the original tool requestId in the normalized result.");
  if (step === "initiated") {
    if (state.phase !== "initiation_started") fail("Initiation is already recorded; do not replace the request.");
    let deadline = Math.min(now + 120000, state.createdAt + 120000);
    if (result.approveBy !== undefined) {
      const parsed = typeof result.approveBy === "number" ? (result.approveBy < 1e12 ? result.approveBy * 1000 : result.approveBy) : Date.parse(result.approveBy);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) fail("Approval deadline is invalid or expired; reconcile the original MCP request.");
      deadline = Math.min(deadline, parsed);
    }
    Object.assign(state, { requestId: result.requestId, firstCompletionBy: deadline,
      deadlineBasis: result.approveBy === undefined ? "local_2_minute_safety_window" : "earlier_of_provider_deadline_and_local_2_minute_window", phase: "awaiting_approval" });
  } else {
    if (result.requestId !== state.requestId) fail("Result belongs to another MCP request.");
    if (step === "approved") {
      if (state.phase !== "awaiting_approval" || result.status !== "approved" || now >= state.firstCompletionBy) fail("Record only an approved original get_request_status result before the first-completion deadline.");
      state.phase = "approved";
    } else if (step === "completed") {
      if (state.phase !== "completion_started") fail("Persist begin-completion before invoking the completion tool.");
      state.phase = "completion_reported";
      if (typeof result.txHash === "string" && hash.test(result.txHash)) state.reportedTxHash = result.txHash;
    } else fail("Unknown result step.");
  }
  // Store only workflow metadata; never save approval URLs, signatures or paid response content.
  writePrivateJson(file, state);
  return { status: state.phase, message: "Local metadata recorded. This does not prove approval, MCP provenance or settlement; the actual tool and seller/chain checks remain authoritative." };
}
export function resumeFlow(file, now = Date.now()) {
  const state = readState(file);
  const args = { requestId: state.requestId };
  if (state.phase === "awaiting_approval") return { status: state.phase, tool: "get_request_status", arguments: args,
    message: "Wait for the human wallet approval; do not approve on their behalf. Record only the original tool result." };
  if (state.phase === "approved" && now < state.firstCompletionBy) return { status: state.phase, command: "begin-completion",
    message: "Persist the completion boundary before calling complete_x402_request." };
  if (state.phase === "completion_started") return { status: state.phase, tool: "complete_x402_request", arguments: args,
    message: "Recover this same requestId only. An expired provider cache requires seller/chain reconciliation, never another initiation." };
  if (state.phase === "completion_reported") return { status: state.phase, command: "status", message: "Check the seller and canonical chain receipt. MCP completion alone is not confirmed funding." };
  return { status: state.phase, command: "status", message: "Inspect the original operation. No replacement initiation is emitted; an unknown outcome never authorizes a new payment." };
}
export function beginCompletion(file, now = Date.now()) {
  const state = readState(file);
  if (state.phase !== "approved" || now >= state.firstCompletionBy) fail("First completion is unapproved or outside its safety window; reconcile the original request.");
  state.phase = "completion_started"; writePrivateJson(file, state);
  return resumeFlow(file, now);
}

export async function verifyFundingReceipt(client, txHash, expected) {
  if (!hash.test(txHash) || await client.getChainId() !== PAYMENT_CHAIN_ID) fail("Wrong transaction hash or RPC network.");
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const [head, block] = await Promise.all([client.getBlockNumber({ cacheTime: 0 }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  if (receipt.transactionHash.toLowerCase() !== txHash.toLowerCase() || block.hash !== receipt.blockHash) fail("Receipt was replaced or reorganized; reconcile.");
  const transfers = parseEventLogs({ abi: eventAbi, logs: receipt.logs.filter(log => log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()), eventName: "Transfer" })
    .filter(log => log.args.from.toLowerCase() === expected.fromAddress.toLowerCase() && log.args.to.toLowerCase() === expected.toAddress.toLowerCase() && log.args.value === expected.amountAtomic);
  if (transfers.length !== 1) fail("Expected exactly one matching canonical USDC transfer.");
  const log = transfers[0];
  const observation = { ...expected, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: log.logIndex,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, confirmations: Number(head - receipt.blockNumber + 1n),
    succeeded: receipt.status === "success", observedAt: Number(block.timestamp) * 1000 };
  validateTransfer(observation, expected);
  return { network: observation.network, tokenAddress: observation.tokenAddress, txHash, logIndex: observation.logIndex,
    blockNumber: observation.blockNumber.toString(), blockHash: observation.blockHash, confirmations: observation.confirmations,
    payerAddress: observation.fromAddress, recipientAddress: observation.toAddress, amountAtomic: observation.amountAtomic.toString() };
}
export async function statusFlow(file, { fetchImpl = fetch, client } = {}) {
  const state = readState(file);
  if (state.phase === "already_funded") return {status:"already_funded",message:"This was already funded before the flow began; no new Wallet MCP payment is demonstrated."};
  const read = await publicResponse(state.resource, {}, fetchImpl);
  if (read.response.status !== 200 || !record(read.body)) fail("Seller status is unavailable. Reconcile the original MCP request; do not pay again.");
  const body = read.body;
  if (body.fundingStatus !== "confirmed") return { status: "not_confirmed", sellerStatus: typeof body.fundingStatus === "string" ? body.fundingStatus : "unknown", message: "No settlement proof yet. Do not create another payment." };
  if (body.orderId !== state.orderId || body.network !== PAYMENT_NETWORK || !hash.test(body.txHash) ||
    body.amountAtomic !== state.status?.amountAtomic || body.recipientAddress?.toLowerCase() !== state.expectedPayTo.toLowerCase()) fail("Seller confirmation changed the approved funding terms.");
  if (body.fundingTermsHash !== state.status.fundingTermsHash || fundingTermsHash({orderId:state.orderId,amountAtomic:body.amountAtomic,payTo:state.expectedPayTo,autoPay:body.autoPay}) !== state.status.fundingTermsHash) fail("The stored buyer rule changed; retain the receipt and review the order without paying again.");
  const rpc = client ?? createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", { timeout: 15000, retryCount: 0 }) });
  const proof = await verifyFundingReceipt(rpc, body.txHash, { fromAddress: state.payerAddress, toAddress: state.expectedPayTo, amountAtomic: BigInt(body.amountAtomic) });
  if (state.reportedTxHash && state.reportedTxHash.toLowerCase() !== proof.txHash.toLowerCase()) fail("MCP-reported and seller transaction hashes differ; reconcile.");
  const mcpCompletionRecorded = state.phase === "completion_reported" || state.proof?.mcpCompletionRecorded === true;
  const result = { status: "confirmed", orderId: state.orderId, proof,
    mcpCompletionRecorded, mcpProvenance: "operator-recorded metadata; not cryptographically attested", ledgerJournalVerified: false,
    explorerUrl: `https://sepolia.basescan.org/tx/${proof.txHash}` };
  state.phase = "confirmed"; state.proof = result; writePrivateJson(file, state);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const [command, subject, ...rest] = args, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith("--") || options[rest[i]] !== undefined) fail("Invalid or repeated command option.");
    options[rest[i]] = rest[i + 1];
  }
  const allowed = command === "prepare" ? ["--origin", "--state", "--max-payment-atomic", "--expected-pay-to", "--payer"] : command === "record" ? ["--step", "--result"] : [];
  if (Object.keys(options).some(key => !allowed.includes(key)) || !subject) fail("Usage: pnpm wallet:fund prepare ORDER_DOCUMENT_ID --max-payment-atomic N --expected-pay-to ADDRESS --payer ADDRESS --state work/wallet.json; record STATE --step initiated|approved|completed --result FILE; resume|begin-completion|status STATE");
  if (command === "prepare") return prepareFlow({ orderId: subject, origin: options["--origin"], stateFile: options["--state"] ?? fail("Choose a private --state file under work/."),
    maxPaymentAtomic: options["--max-payment-atomic"], expectedPayTo: options["--expected-pay-to"], payerAddress: options["--payer"] });
  if (command === "record") return recordFlow(subject, options["--step"], readPrivateJson(options["--result"] ?? fail("Provide --result FILE containing normalized MCP metadata.")));
  if (command === "resume") return resumeFlow(subject);
  if (command === "begin-completion") return beginCompletion(subject);
  if (command === "status") return statusFlow(subject);
  fail("Unknown wallet-flow command.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n")).catch(error => {
    process.stderr.write((error instanceof WalletFlowError ? error.message : "Wallet flow stopped. Inspect the private state and original request before retrying; no automatic replacement payment is allowed.") + "\n");
    process.exitCode = 1;
  });
}
