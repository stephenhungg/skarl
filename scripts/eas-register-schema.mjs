import { scriptConfig } from "./config.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { encodeFunctionData, zeroAddress, zeroHash } from "viem";
import { credentials, requestId, safeError } from "./cdp-policy.ts";
import { EAS_CHAIN_ID, EAS_NETWORK, EAS_SCHEMA, EAS_SCHEMA_UID, REGISTRY_ABI, SCHEMA_REGISTRY_ADDRESS } from "../convex/lib/eas.ts";
import { applyAccountPolicy, ensureFaucet, publicClient, strictContractPolicy, verifyContractPolicy } from "./eas-attestor-setup.mjs";

export async function registerSchema() {
  const client = publicClient();
  if (await client.getChainId() !== EAS_CHAIN_ID) throw new Error("wrong_rpc_network");
  const read = () => client.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "getSchema", args: [EAS_SCHEMA_UID] });
  let schema = await read();
  let transactionHash;
  if (schema.uid === zeroHash) {
    const cdp = credentials();
    // Registration is a separate, narrowly scoped account. The attestor never gains registry permission.
    const account = await cdp.evm.getOrCreateAccount({ name: scriptConfig.easRegistrarAccountName });
    const policy = strictContractPolicy(SCHEMA_REGISTRY_ADDRESS, REGISTRY_ABI, ["register"], "Skarl EAS Base Sepolia schema registration");
    const policyId = await applyAccountPolicy(cdp, account, policy);
    const transaction = { to: SCHEMA_REGISTRY_ADDRESS, value: 0n, data: encodeFunctionData({ abi: REGISTRY_ABI,
      functionName: "register", args: [EAS_SCHEMA, zeroAddress, true] }) };
    await verifyContractPolicy(cdp, account.address, policyId, { register: transaction });
    await ensureFaucet(cdp, client, account);
    ({ transactionHash } = await cdp.evm.sendTransaction({ address: account.address, network: EAS_NETWORK, transaction,
      idempotencyKey: requestId(`eas:register:${EAS_CHAIN_ID}:${account.address}:${EAS_SCHEMA_UID}`) }));
    console.log(JSON.stringify({ submitted: true, schemaUid: EAS_SCHEMA_UID, registrarAddress: account.address, policyId, transactionHash }));
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error("schema_registration_reverted");
    schema = await read();
  }
  if (schema.uid !== EAS_SCHEMA_UID || schema.schema !== EAS_SCHEMA || schema.resolver !== zeroAddress || !schema.revocable) {
    throw new Error("registered_schema_mismatch");
  }
  const result = { schemaUid: EAS_SCHEMA_UID, registered: true, skipped: !transactionHash, transactionHash,
    easscanUrl: `https://base-sepolia.easscan.org/schema/view/${EAS_SCHEMA_UID}`,
    ...(transactionHash ? { basescanUrl: `https://sepolia.basescan.org/tx/${transactionHash}` } : {}) };
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  registerSchema().catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
}
