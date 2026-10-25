import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import type * as chainWitness from "./chainWitness";
import { requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { BANK_WITNESS_LABEL, createNessieClient, compareBankWitness, type BankActivity } from "./lib/nessie";
import { validateTransfer, type ReconciliationException } from "../packages/payments/src/reconciliation";
import { PAYMENT_CHAIN_ID } from "../packages/contracts/src/chain";

export const BANK_LABEL = BANK_WITNESS_LABEL;
export const BANK_FRESH_MS = 5 * 60_000;
const scope = { demoIdentity: v.string(), orderId: v.id("orders") };
type Scope = { demoIdentity: string; orderId: Id<"orders"> };
type Client = ReturnType<typeof createNessieClient>;
const bankRef = <T extends "query" | "mutation" | "action", A extends Record<string, any>, R>(name: string) =>
  makeFunctionReference<T, A, R>(`bankWitness:${name}`);
const chainRef = makeFunctionReference("chainWitness:reconciliationWithWitness") as
  ApiFromModules<{ chainWitness: typeof chainWitness }>["chainWitness"]["reconciliationWithWitness"];
const verified = (member: Doc<"memberships">) => member.status === "active" && member.roles.includes("contributor") &&
  !!member.walletAddress && member.walletVerification?.chainId === PAYMENT_CHAIN_ID;
async function account(ctx: QueryCtx, organizationId: Id<"organizations">, owner: string) {
  return ctx.db.query("bankAccounts").withIndex("by_owner", q => q.eq("organizationId", organizationId).eq("owner", owner)).unique();
}
async function orderScope(ctx: QueryCtx, args: Scope) {
  const principal = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
  const order = await ctx.db.get(args.orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(principal, order);
  return { principal, order };
}
const safeError = (error: unknown) => error instanceof Error && /^nessie_[a-z_0-9]{1,80}$/.test(error.message)
  ? error.message : "nessie_request_uncertain";

/** Synthetic names/addresses only; never export contributor identities to Nessie. */
export const prepareAccounts = internalMutation({ args: {}, handler: async ctx => {
  const principal = await requireRole(ctx, "finance-agent", "finance-agent");
  const members = await ctx.db.query("memberships").withIndex("by_org_identity", q => q.eq("organizationId", principal.organizationId)).collect();
  const owners = ["treasury", ...members.filter(verified).map(member => member.tokenIdentifier)];
  const ids: Id<"bankAccounts">[] = [];
  for (const owner of owners) {
    const prior = await account(ctx, principal.organizationId, owner);
    ids.push(prior?._id ?? await ctx.db.insert("bankAccounts", { organizationId: principal.organizationId,
      owner, nickname: owner === "treasury" ? "Skarl Treasury" : `Skarl Contributor ${ids.length}`,
      status: "new", updatedAt: Date.now() }));
  }
  return ids;
} });

/** Claim each external POST exactly once; a lost response never resets this state. */
export const claimAccountStep = internalMutation({ args: { id: v.id("bankAccounts") }, handler: async (ctx, { id }) => {
  const row = await ctx.db.get(id);
  if (!row || !["new", "customer_ready"].includes(row.status)) return null;
  if (row.owner !== "treasury") {
    const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", row.owner)).unique();
    if (!member || member.organizationId !== row.organizationId || !verified(member)) return null;
  }
  const status = row.status === "new" ? "creating_customer" as const : "creating_account" as const;
  await ctx.db.patch(id, { status, updatedAt: Date.now() });
  return { ...row, status };
} });
export const finishAccountStep = internalMutation({ args: {
  id: v.id("bankAccounts"), step: v.union(v.literal("customer"), v.literal("account")), externalId: v.optional(v.string()), errorCode: v.optional(v.string()),
}, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  if (!row || row.status !== (args.step === "customer" ? "creating_customer" : "creating_account")) return;
  if (args.errorCode) {
    await ctx.db.patch(row._id, { errorCode: args.errorCode, updatedAt: Date.now() });
    return; // Ambiguous POST: retain claim for operator reconciliation, never re-create.
  }
  if (!args.externalId || !/^[a-zA-Z0-9_-]{1,128}$/.test(args.externalId)) throw new Error("invalid_bank_external_id");
  await ctx.db.patch(row._id, args.step === "customer"
    ? { customerId: args.externalId, status: "customer_ready", errorCode: undefined, updatedAt: Date.now() }
    : { accountId: args.externalId, status: "ready", errorCode: undefined, updatedAt: Date.now() });
} });

export const seed = internalAction({ args: {}, handler: async (ctx): Promise<{status: string}> => {
  if (process.env.NESSIE_ENABLED !== "true" || !process.env.NESSIE_API_KEY) return { status: "nessie_not_configured" };
  const ids = await ctx.runMutation(bankRef<"mutation", {}, Id<"bankAccounts">[]>("prepareAccounts"), {});
  const client = createNessieClient({ apiKey: process.env.NESSIE_API_KEY });
  let uncertain = false;
  for (const id of ids) {
    for (let stage = 0; stage < 2; stage++) {
      const row = await ctx.runMutation(bankRef<"mutation", {id: Id<"bankAccounts">}, Doc<"bankAccounts"> | null>("claimAccountStep"), { id });
      if (!row) break;
      const step = row.status === "creating_customer" ? "customer" as const : "account" as const;
      try {
        const result = step === "customer"
          ? await client.createCustomer({ first_name: "Skarl", last_name: `Simulation ${row._id}`, address: {
            street_number: "1", street_name: "Demo Street", city: "Berkeley", state: "CA", zip: "94704" } })
          : await client.createAccount(row.customerId!, { nickname: row.nickname, type: "Checking", rewards: 0, balance: 0 });
        await ctx.runMutation(bankRef<"mutation", {id: Id<"bankAccounts">; step: "customer" | "account"; externalId: string}, null>("finishAccountStep"), {id, step, externalId: result.id});
      } catch (error) {
        await ctx.runMutation(bankRef<"mutation", {id: Id<"bankAccounts">; step: "customer" | "account"; errorCode: string}, null>("finishAccountStep"), {id, step, errorCode: safeError(error)});
        uncertain = true; break;
      }
    }
  }
  return { status: uncertain ? "needs_operator_reconciliation" : "seeded_or_already_claimed" };
} });

export const inputs = internalQuery({ args: {orderId: v.id("orders")}, handler: async (ctx, args) => {
  const {order} = await orderScope(ctx, {...args, demoIdentity: "finance-agent"});
  const treasury = await account(ctx, order.organizationId, "treasury");
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  return {organizationId: order.organizationId, accountId: treasury?.accountId ?? null,
    intentIds: intents.filter(i => i.status === "confirmed" && i.organizationId === order.organizationId).map(i => i._id)};
} });

export const storeSnapshot = internalMutation({ args: { organizationId: v.id("organizations"), accountId: v.string(),
  activitiesJson: v.string(), status: v.union(v.literal("available"), v.literal("unavailable")), reason: v.optional(v.string()),
}, handler: async (ctx, args) => {
  const treasury = await account(ctx, args.organizationId, "treasury");
  if (treasury?.accountId !== args.accountId) throw new Error("bank_treasury_changed");
  const prior = await ctx.db.query("bankSnapshots").withIndex("by_org", q => q.eq("organizationId", args.organizationId)).unique();
  const values = {...args, fetchedAt: Date.now()};
  if (prior) await ctx.db.patch(prior._id, values); else await ctx.db.insert("bankSnapshots", values);
  if (args.status === "available") {
    const activities = JSON.parse(args.activitiesJson) as BankActivity[];
    const operations = await ctx.db.query("bankOperations").withIndex("by_org", q => q.eq("organizationId", args.organizationId)).collect();
    for (const operation of operations) {
      const intent = await ctx.db.get(operation.paymentIntentId);
      const expected = intent ? await bankExpectation(ctx, intent) : null;
      if (!expected || !operationAgrees(operation, intent!, expected)) continue;
      const result = compareBankWitness(expected, activities);
      if (result.status === "match") await ctx.db.patch(operation._id, {
        status: "observed", activityId: result.activityIds[0], errorCode: undefined, updatedAt: Date.now(),
      });
    }
  }
} });

/** Durable business intent precedes every simulated deposit/off-ramp POST. */
export const claimOperation = internalMutation({ args: {intentId: v.id("paymentIntents")}, handler: async (ctx, args): Promise<Doc<"bankOperations"> | null> => {
  const intent = await ctx.db.get(args.intentId);
  if (!intent || intent.status !== "confirmed" || intent.amountAtomic <= 0n) return null;
  const {order} = await orderScope(ctx, { demoIdentity: "finance-agent", orderId: intent.orderId });
  if (intent.organizationId !== order.organizationId) throw new Error("bank_intent_tenant_mismatch");
  const prior = await ctx.db.query("bankOperations").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique();
  if (prior) return null;
  // Existing reconciliation must agree, including the identified chain transfer and exact journal.
  const reconciliation = await ctx.runQuery(api.payments.reconciliation, {demoIdentity: "finance-agent", orderId: intent.orderId});
  if (!reconciliation.matches.some(match => match.eventKey === intent.intentId)) return null;
  const treasury = await account(ctx, intent.organizationId, "treasury");
  if (treasury?.status !== "ready" || !treasury.accountId) return null;
  let payeeId: string | undefined;
  if (intent.kind === "contributor_payout") {
    const payable = await ctx.db.get(intent.payableId);
    if (!payable || payable.organizationId !== intent.organizationId || payable.orderId !== intent.orderId ||
      payable.status !== "paid" || payable.amountAtomic !== intent.amountAtomic || payable.recipientAddress !== intent.recipientAddress) return null;
    const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", payable.contributorTokenIdentifier)).unique();
    if (!member || !verified(member) || member.organizationId !== intent.organizationId ||
      member.walletAddress?.toLowerCase() !== payable.recipientAddress.toLowerCase()) return null;
    const destination = await account(ctx, intent.organizationId, payable.contributorTokenIdentifier);
    if (destination?.status !== "ready" || !destination.accountId) return null;
    payeeId = destination.accountId;
  }
  const snapshot = await ctx.db.query("bankSnapshots").withIndex("by_org", q => q.eq("organizationId", intent.organizationId)).unique();
  // Never POST without an authenticated, recent read; detect prior/foreign duplicates first.
  if (!snapshot || snapshot.status !== "available" || snapshot.accountId !== treasury.accountId || Date.now() - snapshot.fetchedAt > BANK_FRESH_MS) return null;
  const activities = JSON.parse(snapshot.activitiesJson) as BankActivity[];
  const seen = activities.some(row => row.description === intent.intentId);
  const compared = compareBankWitness({intentId: intent.intentId, amountAtomic: intent.amountAtomic.toString(),
    kind: intent.kind === "contributor_payout" ? "transfer" : "deposit", accountId: treasury.accountId,
    ...(payeeId ? {payeeId} : {})}, activities);
  const id = await ctx.db.insert("bankOperations", {organizationId: intent.organizationId, orderId: intent.orderId,
    paymentIntentId: intent._id, intentId: intent.intentId, kind: intent.kind === "contributor_payout" ? "transfer" : "deposit",
    amountAtomic: intent.amountAtomic, accountId: treasury.accountId, ...(payeeId ? {payeeId} : {}),
    status: seen ? compared.status === "match" ? "observed" : "uncertain" : "sending",
    ...(compared.status === "match" ? {activityId: compared.activityIds[0]} : {}),
    ...(seen && compared.status !== "match" ? {errorCode: "nessie_existing_activity_unmatched"} : {}),
    createdAt: Date.now(), updatedAt: Date.now()});
  return seen ? null : await ctx.db.get(id);
} });
export const finishOperation = internalMutation({ args: { id: v.id("bankOperations"), activityId: v.optional(v.string()), errorCode: v.optional(v.string()) }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  if (!row || row.status !== "sending") return;
  await ctx.db.patch(row._id, {status: args.activityId ? "submitted" : "uncertain", activityId: args.activityId,
    errorCode: args.errorCode, updatedAt: Date.now()});
} });

export const syncOrder = internalAction({args: {orderId: v.id("orders")}, handler: async (ctx, args): Promise<{status: string}> => {
  if (process.env.NESSIE_ENABLED !== "true" || !process.env.NESSIE_API_KEY) return {status: "nessie_not_configured"};
  const input = await ctx.runQuery(bankRef<"query", typeof args, {organizationId: Id<"organizations">; accountId: string | null; intentIds: Id<"paymentIntents">[]}>("inputs"), args);
  if (!input.accountId) return {status: "bank_account_missing"};
  const accountId = input.accountId;
  const client: Client = createNessieClient({apiKey: process.env.NESSIE_API_KEY});
  const store = async (status: "available" | "unavailable", rows: BankActivity[], reason?: string) => ctx.runMutation(
    bankRef<"mutation", {organizationId: Id<"organizations">; accountId: string; activitiesJson: string; status: "available" | "unavailable"; reason?: string}, null>("storeSnapshot"),
    {organizationId: input.organizationId, accountId, activitiesJson: JSON.stringify(rows), status, ...(reason ? {reason} : {})});
  try {
    // A bad key can return []/200: authenticate by exact known account before any list.
    await client.verifyAccount(accountId);
    await store("available", await client.activity(accountId));
    for (const intentId of input.intentIds) {
      const operation = await ctx.runMutation(bankRef<"mutation", {intentId: Id<"paymentIntents">}, Doc<"bankOperations"> | null>("claimOperation"), {intentId});
      if (!operation) continue;
      try {
        const payload = {amountAtomic: operation.amountAtomic.toString(), description: operation.intentId,
          transactionDate: new Date(operation.createdAt).toISOString().slice(0, 10)};
        const result = operation.kind === "deposit" ? await client.deposit(operation.accountId, payload)
          : await client.transfer(operation.accountId, {...payload, payeeId: operation.payeeId!});
        await ctx.runMutation(bankRef<"mutation", {id: Id<"bankOperations">; activityId: string}, null>("finishOperation"), {id: operation._id, activityId: result.id});
      } catch (error) {
        await ctx.runMutation(bankRef<"mutation", {id: Id<"bankOperations">; errorCode: string}, null>("finishOperation"), {id: operation._id, errorCode: safeError(error)});
      }
    }
    await store("available", await client.activity(accountId));
    return {status: "refreshed"};
  } catch (error) {
    await store("unavailable", [], safeError(error));
    return {status: "bank_unavailable"};
  }
} });

export const ordersPage = internalQuery({args: {cursor: v.optional(v.string())}, handler: async (ctx, args) => {
  const principal = await requireRole(ctx, "finance-agent", "finance-agent");
  const page = await ctx.db.query("orders").withIndex("by_org_status", q => q.eq("organizationId", principal.organizationId))
    .paginate({cursor: args.cursor ?? null, numItems: 5});
  return {orderIds: page.page.map(row => row._id), cursor: page.isDone ? null : page.continueCursor};
} });
export const sweep = internalAction({args: {cursor: v.optional(v.string())}, handler: async (ctx, args): Promise<{status: string}> => {
  if (process.env.NESSIE_ENABLED !== "true" || !process.env.NESSIE_API_KEY) return {status: "nessie_not_configured"};
  if (!args.cursor) await ctx.runAction(bankRef<"action", {}, {status: string}>("seed"), {});
  const page = await ctx.runQuery(bankRef<"query", typeof args, {orderIds: Id<"orders">[]; cursor: string | null}>("ordersPage"), args);
  for (const orderId of page.orderIds) await ctx.runAction(bankRef<"action", {orderId: Id<"orders">}, {status: string}>("syncOrder"), {orderId});
  if (page.cursor) await ctx.scheduler.runAfter(1000, bankRef<"action", {cursor: string}, {status: string}>("sweep"), {cursor: page.cursor});
  return {status: "swept"};
} });

async function bankExpectation(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  const order = await ctx.db.get(intent.orderId);
  if (!order || order.organizationId !== intent.organizationId) return null;
  const treasury = await account(ctx, intent.organizationId, "treasury");
  if (treasury?.status !== "ready" || !treasury.accountId) return null;
  let payeeId: string | undefined;
  if (intent.kind === "contributor_payout") {
    const payable = await ctx.db.get(intent.payableId);
    if (!payable || payable.organizationId !== intent.organizationId || payable.orderId !== intent.orderId ||
      payable.amountAtomic !== intent.amountAtomic || payable.recipientAddress !== intent.recipientAddress) return null;
    const destination = await account(ctx, intent.organizationId, payable.contributorTokenIdentifier);
    if (destination?.status !== "ready" || !destination.accountId) return null;
    payeeId = destination.accountId;
  } else if (intent.amountAtomic !== order.budgetAtomic) return null;
  return {intentId: intent.intentId, amountAtomic: intent.amountAtomic.toString(), accountId: treasury.accountId,
    kind: intent.kind === "contributor_payout" ? "transfer" as const : "deposit" as const, ...(payeeId ? {payeeId} : {})};
}
function operationAgrees(operation: Doc<"bankOperations">, intent: Doc<"paymentIntents">,
  expected: NonNullable<Awaited<ReturnType<typeof bankExpectation>>>) {
  return operation.organizationId === intent.organizationId && operation.orderId === intent.orderId &&
    operation.intentId === intent.intentId && operation.amountAtomic === intent.amountAtomic &&
    operation.accountId === expected.accountId && operation.kind === expected.kind && operation.payeeId === expected.payeeId;
}

type Column = {status: "match" | "missing" | "mismatch"; amountAtomic?: string; reason?: string};
export type BankException = Omit<ReconciliationException, "code"> & {code: "bank_mismatch"};
async function bankRows(ctx: QueryCtx, args: Scope) {
  const {order} = await orderScope(ctx, args);
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const treasury = await account(ctx, order.organizationId, "treasury");
  const snapshot = await ctx.db.query("bankSnapshots").withIndex("by_org", q => q.eq("organizationId", order.organizationId)).unique();
  const fresh = snapshot?.status === "available" && snapshot.accountId === treasury?.accountId && Date.now() - snapshot.fetchedAt < BANK_FRESH_MS;
  const activities: BankActivity[] = fresh ? JSON.parse(snapshot.activitiesJson) as BankActivity[] : [];
  const rows: {intent: Doc<"paymentIntents">; bank: Column; activityIds: string[]}[] = [];
  const exceptions: BankException[] = [];
  for (const intent of intents) {
    if (intent.organizationId !== order.organizationId) throw new Error("bank_intent_tenant_mismatch");
    const operation = await ctx.db.query("bankOperations").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique();
    let result: ReturnType<typeof compareBankWitness>;
    if (!fresh) result = {status: "missing", reason: snapshot?.reason ?? "bank_not_refreshed_or_stale", activityIds: []};
    else if (!operation) {
      const unclaimed = activities.filter(activity => activity.description === intent.intentId);
      result = unclaimed.length ? {status: "mismatch", reason: "unexpected_bank_activity_without_business_claim", activityIds: unclaimed.map(activity => activity.id)}
        : {status: "missing", reason: "bank_intent_not_prepared", activityIds: []};
    }
    else {
      const expected = await bankExpectation(ctx, intent);
      result = !expected || !operationAgrees(operation, intent, expected)
        ? {status: "mismatch", reason: "bank_intent_binding_changed", activityIds: []}
        : compareBankWitness(expected, activities);
    }
    const observed = result.activityIds.length === 1 ? activities.find(activity => activity.id === result.activityIds[0]) : undefined;
    rows.push({intent, bank: {status: result.status, ...(observed ? {amountAtomic: observed.amountAtomic} : {}),
      ...(result.reason ? {reason: result.reason} : {})}, activityIds: result.activityIds});
    if (result.status === "mismatch") exceptions.push({code: "bank_mismatch", eventKey: intent.intentId, orderId: order._id,
      detail: `${BANK_LABEL}: ${result.reason ?? "bank_activity_disagrees"}`});
  }
  // Treasury-wide unmatched activity stays visible without attributing it to this order.
  for (const activity of activities) {
    const known = await ctx.db.query("paymentIntents").withIndex("by_intent_id", q => q.eq("intentId", activity.description)).unique();
    if (!known || known.organizationId !== order.organizationId) exceptions.push({code: "bank_mismatch",
      detail: `${BANK_LABEL}: unmatched treasury activity ${activity.id}; not allocated to this order`});
  }
  return {rows, exceptions, fetchedAt: snapshot?.fetchedAt ?? null, available: !!fresh};
}
/** Added to the existing exception disposition queue; never mutates financial state. */
export const bankExceptions = query({args: scope, handler: async (ctx, args): Promise<BankException[]> => (await bankRows(ctx, args)).exceptions});

/** Per-obligation columns, with existing RPC/ledger and independent CDP witness evidence retained. */
export const reconciliation4Way = query({args: scope, handler: async (ctx, args) => {
  const bank = await bankRows(ctx, args);
  const existing = await ctx.runQuery(chainRef, args);
  const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", args.orderId)).collect();
  const rows: {intentId: string; kind: string; order: Column; ledger: Column; chain: Column; bank: Column; activityIds: string[]}[] = [];
  for (const row of bank.rows) {
    const intent = row.intent;
    const order = await ctx.db.get(intent.orderId);
    const payable = intent.kind === "contributor_payout" ? await ctx.db.get(intent.payableId) : null;
    const expected = intent.kind === "contributor_payout" ? payable?.amountAtomic : order?.budgetAtomic;
    const orderAgrees = expected === intent.amountAtomic && (intent.kind !== "contributor_payout" ||
      !!payable && payable.organizationId === intent.organizationId && payable.orderId === intent.orderId &&
      payable.recipientAddress === intent.recipientAddress && payable.network === intent.network && payable.tokenAddress === intent.tokenAddress);
    const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
    const observations: Doc<"chainObservations">[] = [];
    for (const attempt of attempts) observations.push(...await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect());
    let chain: Column = {status: "missing"};
    if (observations.length) {
      chain = {status: "mismatch"};
      if (observations.length === 1 && expected !== undefined) {
        try {
          const observation = observations[0]!;
          if (observation.organizationId !== intent.organizationId) throw new Error("chain_tenant_mismatch");
          validateTransfer(observation, {network: intent.network, amountAtomic: expected, toAddress: intent.recipientAddress,
            fromAddress: intent.kind === "contributor_payout" ? attempts[0]?.payerAddress ?? "" : intent.buyerWalletAddress});
          chain = {status: "match", amountAtomic: observation.amountAtomic.toString()};
        } catch { chain.reason = "chain_binding_or_amount_mismatch"; }
      }
    }
    const journals = entries.filter(entry => entry.eventKey === intent.intentId);
    const baseExceptions = existing.exceptions.filter(exception => exception.eventKey === intent.intentId);
    const ledger: Column = {status: journals.length === 0 ? "missing" : journals.length !== 1 ||
      baseExceptions.some(e => e.code === "ledger_mismatch" || e.code === "duplicate_obligation" || e.code === "duplicate_transfer") || chain.status !== "match"
      ? "mismatch" : "match"};
    rows.push({intentId: intent.intentId, kind: intent.kind ?? "funding", order: {
      status: expected === undefined ? "missing" : orderAgrees ? "match" : "mismatch",
      ...(expected !== undefined ? {amountAtomic: expected.toString()} : {})}, ledger, chain, bank: row.bank, activityIds: row.activityIds});
  }
  // Include every remaining obligation reported by the canonical reconciliation.
  // These legs have no bank simulator; avoid disguising absent coverage as agreement.
  const {order: scopedOrder} = await orderScope(ctx, args);
  const otherAmounts = new Map<string, string>();
  const refunds = await ctx.db.query("paymentCommands").withIndex("by_order_kind", q => q.eq("orderId", args.orderId).eq("kind", "buyer_refund")).collect();
  for (const command of refunds) {
    if (command.organizationId === scopedOrder.organizationId) otherAmounts.set(`refund_paid:${command._id}`, command.amountAtomic.toString());
  }
  // The canonical reconciliation above validates these claim/attempt bindings.
  const claims = await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", scopedOrder.organizationId)).collect();
  for (const claim of claims) {
    if (claim.action !== "evidence_sale_claimed") continue;
    const terms = JSON.parse(claim.reason) as {orderId: string; amountAtomic: string};
    if (terms.orderId === args.orderId) otherAmounts.set(`evidence:${claim.entityId}`, terms.amountAtomic);
  }
  const represented = new Set(rows.map(row => row.intentId));
  const otherKeys = new Set([...existing.matches.map(match => match.eventKey),
    ...existing.exceptions.flatMap(exception => exception.eventKey ? [exception.eventKey] : [])]);
  for (const intentId of otherKeys) {
    if (represented.has(intentId)) continue;
    const errors = existing.exceptions.filter(item => item.eventKey === intentId);
    const journal = entries.find(entry => entry.eventKey === intentId);
    const kind = intentId.startsWith("refund_paid:") ? "refund_paid" : intentId.startsWith("evidence:") ? "evidence_sale" : "unallocated";
    const amountAtomic = otherAmounts.get(intentId);
    const known = amountAtomic !== undefined;
    const codes = new Set(errors.map(error => error.code));
    rows.push({intentId, kind,
      order: {status: !known ? "missing" : codes.has("duplicate_obligation") ? "mismatch" : "match", ...(known ? {amountAtomic} : {})},
      ledger: {status: !journal ? "missing" : !known || codes.has("ledger_mismatch") || codes.has("duplicate_transfer") || codes.has("duplicate_obligation") ? "mismatch" : "match"},
      chain: {status: codes.has("missing_transfer") || !known ? "missing" :
        ["wrong_amount", "unknown_transfer", "invalid_transfer", "duplicate_transfer", "duplicate_obligation"].some(code => codes.has(code as ReconciliationException["code"])) ? "mismatch" : "match"},
      bank: {status: "missing", reason: "outside_bank_simulation_scope"}, activityIds: []});
  }
  return {label: BANK_LABEL, simulated: true, rows, exceptions: [...existing.exceptions, ...bank.exceptions],
    // Preserve other obligations (refunds/evidence sales) without implying their bank leg is implemented.
    bankScope: "confirmed order funding and contributor payouts only", bankAvailable: bank.available, bankFetchedAt: bank.fetchedAt,
    reconciliation: {...existing, matches: existing.matches.map(match => ({...match, amountAtomic: match.amountAtomic.toString()}))}};
} });

/** Operator-only. HTTP 400/422 is a provider validation refusal, which proves no bank record was created,
 * so the intent may be attempted again. Timeouts and every other outcome stay uncertain. */
export const releaseRejectedOperations = internalMutation({ args: { organizationId: v.id("organizations") }, handler: async (ctx, args) => {
  const rows = await ctx.db.query("bankOperations").withIndex("by_org", q => q.eq("organizationId", args.organizationId)).collect();
  const rejected = rows.filter(row => row.status === "uncertain" && !row.activityId && (row.errorCode === "nessie_http_400" || row.errorCode === "nessie_http_422"));
  for (const row of rejected) await ctx.db.delete(row._id);
  return { released: rejected.length };
} });
