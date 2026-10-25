import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi, parseAbiParameters, zeroAddress, zeroHash } from "viem";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, PAYMENT_RAILS } from "../../packages/contracts/src/chain.ts";

// Official EAS Base Sepolia 1.2.0 predeploys; no Skarl contract is deployed.
export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;
export const EAS_NETWORK = "base-sepolia" as const;
export const EAS_CHAIN_ID = PAYMENT_CHAIN_ID;
export const ATTESTOR_NAME = "skarl-attestor";
export const EAS_SCHEMA = "bytes32 reportHash, bytes32 sourceSha256, bytes32 rubricHash, string pipelineVersion, string videoModel, string recommendation, uint64 verifiedAt, bool licensed";
export const EAS_SCHEMA_UID = keccak256(encodePacked(["string", "address", "bool"], [EAS_SCHEMA, zeroAddress, true]));
export const EAS_ABI = parseAbi([
  "function attest((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data) request) payable returns (bytes32)",
  "function revoke((bytes32 schema, (bytes32 uid, uint256 value) data) request) payable",
  "function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))",
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
]);
export const REGISTRY_ABI = parseAbi([
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))",
]);
const parameters = parseAbiParameters(EAS_SCHEMA);
export type AttestationFields = {
  reportHash: `0x${string}`; sourceSha256: `0x${string}`; rubricHash: `0x${string}`;
  pipelineVersion: string; videoModel: string; recommendation: "accept" | "needs_review" | "request_correction";
  verifiedAt: number; licensed: boolean;
};
export const sha256Text = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
export function bytes32(value: string): `0x${string}` {
  if (!/^(0x)?[a-f0-9]{64}$/.test(value)) throw new Error("invalid_attestation_hash");
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}
// Free-form report text, names, URLs, IDs and contributor wallets are never encoded.
// These versions/models are server-owned metadata, not strings from observations.
const models = new Set(["gemini-4-argon", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"]);
export function buildAttestationFields(input: {
  reportJson: string; reportHash: string; sourceHash: string; rubricHash: string; pipelineVersion: string;
  submissionId: string; taskVersionId: string; completedAt: number; licensed: boolean;
}): AttestationFields {
  const report = JSON.parse(input.reportJson);
  if (sha256Text(input.reportJson) !== input.reportHash || report.source?.sha256 !== input.sourceHash ||
    report.submissionId !== input.submissionId || report.taskVersionId !== input.taskVersionId ||
    report.pipeline?.version !== input.pipelineVersion) throw new Error("attestation_report_mismatch");
  if (input.pipelineVersion !== "task-evidence-2.0" && !/^red-cup-evidence-\d+\.\d+(?:\.\d+)?$/.test(input.pipelineVersion)) throw new Error("unapproved_pipeline_version");
  if (!["accept", "needs_review", "request_correction"].includes(report.recommendation) ||
    ((report.pipeline.implementation !== "inference" || report.pipeline.status !== "completed") && report.recommendation !== "needs_review")) {
    throw new Error("invalid_attestation_recommendation");
  }
  const runs = report.pipeline.modelRuns;
  if (!Array.isArray(runs)) throw new Error("invalid_model_runs");
  const visual = runs.filter((run: {promptVersion?: unknown}) => typeof run.promptVersion === "string" && /^(timestamped-frames-visible-events|video-only-events|silent-video-events|silent-visible-events)-v\d+$/.test(run.promptVersion));
  const videoModels: string[] = [...new Set<string>(visual.map((run: {model: string}) => run.model))];
  if (videoModels.some(model => !models.has(model))) throw new Error("unapproved_video_model");
  const verifiedAt = Math.floor(input.completedAt / 1000);
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt <= 0) throw new Error("invalid_verified_at");
  return { reportHash: bytes32(input.reportHash), sourceSha256: bytes32(input.sourceHash), rubricHash: bytes32(input.rubricHash),
    pipelineVersion: input.pipelineVersion, videoModel: videoModels.join(",") || "unavailable",
    recommendation: report.recommendation, verifiedAt, licensed: input.licensed };
}
export function encodeAttestation(fields: AttestationFields) {
  return encodeAbiParameters(parameters, [fields.reportHash, fields.sourceSha256, fields.rubricHash,
    fields.pipelineVersion, fields.videoModel, fields.recommendation, BigInt(fields.verifiedAt), fields.licensed]);
}
export function attestTransaction(fields: AttestationFields) {
  return { to: EAS_ADDRESS, value: 0n, data: encodeFunctionData({ abi: EAS_ABI, functionName: "attest",
    args: [{ schema: EAS_SCHEMA_UID, data: { recipient: zeroAddress, expirationTime: 0n, revocable: true,
      refUID: zeroHash, data: encodeAttestation(fields), value: 0n } }] }) };
}
export function attestationLinks(uid: string, txHash: string) {
  return { easscanUrl: `https://base-sepolia.easscan.org/attestation/view/${encodeURIComponent(uid)}`,
    basescanUrl: PAYMENT_RAILS[PAYMENT_NETWORK].explorerTx(txHash) };
}
export function attestationRequestId(identity: string) {
  const hex = sha256Text(identity);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
