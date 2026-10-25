import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { hashMessage } from "viem";
import schema from "./schema";
import { internal } from "./_generated/api";
import { PAYMENT_CHAIN_ID } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const challenge = makeFunctionReference<"mutation">("contributorWallet:challenge");
const verify = makeFunctionReference<"mutation">("contributorWallet:verify");
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const wrongAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);
const common = { demoIdentity: "controller", contributorTokenIdentifier: "demo:skarl:contributor" };
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.demo, {});
  return t;
}

describe("contributor wallet registration with real local signatures (no chain transaction)", () => {
  it("issues a bound Base Sepolia SIWE message and atomically verifies it exactly once", async () => {
    const t = await setup();
    const issued = await t.mutation(challenge, { ...common, walletAddress: account.address });
    const parsed = parseSiweMessage(issued.message);
    expect(parsed).toMatchObject({ address: account.address, domain: "skarl.vercel.app", uri: "https://skarl.vercel.app", chainId: PAYMENT_CHAIN_ID });
    expect(parsed.statement).toContain(common.contributorTokenIdentifier);
    expect(parsed.resources).toHaveLength(2);
    const signature = await account.signMessage({ message: issued.message });
    const args = { ...common, nonce: issued.nonce, signature };
    const result = await t.mutation(verify, args);
    expect(result).toMatchObject({ verified: true, replayed: false, walletAddress: account.address.toLowerCase(), chainId: PAYMENT_CHAIN_ID });
    expect(await t.mutation(verify, args)).toMatchObject({ ...result, replayed: true });
    await t.run(async ctx => {
      const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", common.contributorTokenIdentifier)).unique();
      expect(member?.walletChallenge).toBeUndefined();
      expect(member?.walletVerification).toMatchObject({ signature, nonce: issued.nonce, chainId: PAYMENT_CHAIN_ID, siweMessageHash: hashMessage(issued.message) });
      const audits = await ctx.db.query("auditEvents").collect();
      expect(audits.filter(e => e.action === "contributor_wallet_verified")).toHaveLength(1);
    });
    await expect(t.mutation(challenge, { ...common, walletAddress: wrongAccount.address })).rejects.toThrow("wallet_already_verified");
    await expect(t.mutation(verify, { ...args, nonce: "different" })).rejects.toThrow("wallet_already_verified");
  });

  it.each(["buyer", "contributor", "finance-agent"])("refuses %s for issuing and verifying", async demoIdentity => {
    const t = await setup();
    await expect(t.mutation(challenge, { ...common, demoIdentity, walletAddress: account.address })).rejects.toThrow();
    const issued = await t.mutation(challenge, { ...common, walletAddress: account.address });
    await expect(t.mutation(verify, { ...common, demoIdentity, nonce: issued.nonce, signature: await account.signMessage({ message: issued.message }) })).rejects.toThrow();
  });

  it.each(["wrong signer", "wrong chain", "wrong domain", "wrong membership", "malformed signature"])("rejects %s without consuming the challenge", async scenario => {
    const t = await setup();
    const issued = await t.mutation(challenge, { ...common, walletAddress: account.address });
    let message = issued.message;
    if (scenario === "wrong chain") message = message.replace(`Chain ID: ${PAYMENT_CHAIN_ID}`, "Chain ID: 1");
    if (scenario === "wrong domain") message = message.replaceAll("skarl.vercel.app", "attacker.example");
    if (scenario === "wrong membership") message = message.replace(common.contributorTokenIdentifier, "demo:skarl:someone-else");
    const signature = scenario === "malformed signature" ? "0x00" : await (scenario === "wrong signer" ? wrongAccount : account).signMessage({ message });
    await expect(t.mutation(verify, { ...common, nonce: issued.nonce, signature })).rejects.toThrow("invalid_wallet_signature");
    expect(await t.mutation(verify, { ...common, nonce: issued.nonce, signature: await account.signMessage({ message: issued.message }) })).toMatchObject({ verified: true });
  });

  it("rejects superseded nonces and expired signatures", async () => {
    vi.useFakeTimers();
    const t = await setup();
    const first = await t.mutation(challenge, { ...common, walletAddress: account.address });
    const second = await t.mutation(challenge, { ...common, walletAddress: account.address });
    expect(first.nonce).not.toBe(second.nonce);
    await expect(t.mutation(verify, { ...common, nonce: first.nonce, signature: await account.signMessage({ message: first.message }) })).rejects.toThrow("wallet_challenge_not_found");
    vi.setSystemTime(second.expiresAt);
    await expect(t.mutation(verify, { ...common, nonce: second.nonce, signature: await account.signMessage({ message: second.message }) })).rejects.toThrow("wallet_challenge_expired");
  });

  it("refuses cross-tenant registration and inactive or non-contributor memberships", async () => {
    const t = await setup();
    await expect(t.mutation(challenge, { ...common, contributorTokenIdentifier: "demo:skarl:buyer", walletAddress: account.address })).rejects.toThrow("active_contributor_required");
    await t.run(async ctx => {
      const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", common.contributorTokenIdentifier)).unique();
      await ctx.db.patch(member!._id, { status: "revoked" });
    });
    await expect(t.mutation(challenge, { ...common, walletAddress: account.address })).rejects.toThrow("active_contributor_required");
    await t.run(async ctx => {
      const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", common.contributorTokenIdentifier)).unique();
      const organizationId = await ctx.db.insert("organizations", { name: "Other", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(member!._id, { status: "active", organizationId });
    });
    await expect(t.mutation(challenge, { ...common, walletAddress: account.address })).rejects.toThrow("cross_organization_access");
  });
});
