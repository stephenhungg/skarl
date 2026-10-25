#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";

// Creation responses contain secrets. Never log responses, headers, errors or env contents.
const configDir = join(homedir(), ".config/skarl");
const credentialFile = join(configDir, "cdp.env");
const stateFile = join(configDir, "cdp-webhook.env");
const path = "/platform/v2/data/webhooks/subscriptions";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const webDir = new URL("../apps/web/", import.meta.url);
const persist = state => {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temporary, Object.entries(state).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, stateFile);
};
async function authorization() {
  const apiKeyId = process.env.CDP_API_KEY_ID, apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new Error("cdp_credentials_missing");
  try {
    const { generateJwt } = webRequire("@coinbase/cdp-sdk/auth");
    return `Bearer ${await generateJwt({ apiKeyId, apiKeySecret, requestMethod: "POST", requestHost: "api.cdp.coinbase.com", requestPath: path })}`;
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND") throw new Error("cdp_authentication_failed");
    const { createAuthHeader } = webRequire("@coinbase/x402");
    return createAuthHeader(apiKeyId, apiKeySecret, "POST", "api.cdp.coinbase.com", path);
  }
}
async function main() {
  if (existsSync(credentialFile)) process.loadEnvFile(credentialFile);
  const appUrl = process.argv[2] ?? process.env.SKARL_APP_URL;
  const treasury = process.env.SKARL_TREASURY_ADDRESS;
  if (!appUrl || !treasury || !/^0x[0-9a-f]{40}$/i.test(treasury) || /^0x0{40}$/i.test(treasury)) {
    throw new Error("usage: SKARL_TREASURY_ADDRESS=0x... node scripts/cdp-webhooks-create.mjs https://production-host");
  }
  const target = new URL("/api/webhooks/cdp", appUrl);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("public_https_url_required");
  const state = existsSync(stateFile) ? parseEnv(readFileSync(stateFile, "utf8")) : {};
  if ((state.CDP_WEBHOOK_URL && state.CDP_WEBHOOK_URL !== target.href) ||
      (state.CDP_WEBHOOK_TREASURY && state.CDP_WEBHOOK_TREASURY !== treasury.toLowerCase())) throw new Error("existing_subscription_scope_changed_review_manually");
  const head = await fetch(target, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!head.ok) throw new Error("webhook_head_probe_failed");
  for (const direction of ["TO", "FROM"]) {
    const prefix = `CDP_WEBHOOK_${direction}`;
    if (state[`${prefix}_STATE`] === "created" && state[`CDP_WEBHOOK_SECRET_${direction}`]) continue;
    if (state[`${prefix}_STATE`]) throw new Error("subscription_creation_uncertain_review_cdp_before_retry");
    const auth = await authorization();
    Object.assign(state, { CDP_WEBHOOK_URL: target.href, CDP_WEBHOOK_TREASURY: treasury.toLowerCase(), [`${prefix}_STATE`]: "creating" });
    persist(state); // Lost responses cannot cause an automatic duplicate creation on rerun.
    const response = await fetch(`https://api.cdp.coinbase.com${path}`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ description: `Skarl ${PAYMENT_NETWORK} treasury USDC ${direction.toLowerCase()}`,
        eventTypes: ["onchain.activity.detected"], isEnabled: true, target: { url: target.href },
        labels: { network: "base-sepolia", contract_address: USDC_ADDRESS.toLowerCase(), event_name: "Transfer",
          [`params.${direction.toLowerCase()}`]: treasury.toLowerCase() } }),
    });
    if (!response.ok) throw new Error(`subscription_create_http_${response.status}_review_before_retry`);
    const result = await response.json();
    const secret = result.secret ?? result.metadata?.secret;
    if (typeof secret !== "string" || !secret || typeof result.subscriptionId !== "string") throw new Error("subscription_response_incomplete_review_cdp");
    Object.assign(state, { [`${prefix}_STATE`]: "created", [`${prefix}_ID`]: result.subscriptionId, [`CDP_WEBHOOK_SECRET_${direction}`]: secret });
    persist(state);
    console.log(`created ${direction.toLowerCase()} subscription ${result.subscriptionId}`);
  }
  console.log("signing secrets saved only to ~/.config/skarl/cdp-webhook.env (mode 600).");
  console.log(`Vercel project linked locally: ${existsSync(new URL(".vercel/project.json", webDir)) ? "yes" : "no"}.`);
  console.log("set CDP_WEBHOOK_SECRET_TO and CDP_WEBHOOK_SECRET_FROM from that private file in the Vercel production environment, then redeploy.");
  console.log("also configure SKARL_TREASURY_ADDRESS and the existing payment service environment. set CDP_CLIENT_API_KEY in Convex for SQL refresh; do not run a cloud deploy from this worktree.");
}
main().catch(error => {
  const known = error instanceof Error && /^(usage:|public_https_|existing_subscription_|webhook_head_|subscription_|cdp_credentials_|cdp_authentication_)/.test(error.message);
  console.error(known ? error.message : "webhook_setup_failed_review_private_state_before_retry");
  process.exitCode = 1;
});
