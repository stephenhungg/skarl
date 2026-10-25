import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createFundingJournal, createFulfillmentJournal, createPayoutJournal } from "../packages/ledger/src/index";
import { recordJournal } from "./lib/finance";
import { reportingThreshold, taxCsv } from "./lib/tax";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const contributor = "demo:skarl:contributor";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function setup() {
  const t = convexTest(schema, modules);
  const seed = await t.mutation(internal.seed.demo, {});
  return { t, ...seed };
}
/** Synthetic ledger lifecycle; this is not chain or inference evidence. */
async function paid(f: Awaited<ReturnType<typeof setup>>, amount = 600_000_000n) {
  return f.t.run(async ctx => {
    const order = (await ctx.db.get(f.defaultOrderId))!;
    const { _id, _creationTime, ...terms } = order;
    const orderId = await ctx.db.insert("orders", { ...terms, publicId: "synthetic-tax-history" });
    await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "tax:funding", orderId, amountMicroUsdc: amount }));
    await recordJournal(ctx, f.organizationId, createFulfillmentJournal({ eventId: "tax:earned", orderId, sampleId: "synthetic-sample", contributorId: contributor, priceMicroUsdc: amount, contributorMicroUsdc: amount }));
    const journal = createPayoutJournal({ eventId: "tax:paid", orderId, payableId: "synthetic-sample", contributorId: contributor, amountMicroUsdc: amount });
    const entryId = await recordJournal(ctx, f.organizationId, journal);
    expect(await recordJournal(ctx, f.organizationId, journal)).toBe(entryId);
    return { orderId, entryId };
  });
}
describe("demo tax profile protects identity data and authority", () => {
  it("audits every changed attestation even when the clock has not advanced", async () => {
    vi.useFakeTimers();
    const f = await setup();
    for (const taxForm of ["none", "w9_on_file", "none"] as const) {
      await f.t.mutation(api.tax.setProfile, { demoIdentity: "contributor", country: "US", taxForm });
    }
    const events = (await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(row => row.action === "contributor_tax_profile_attested");
    expect(events).toHaveLength(3);
    expect(new Set(events.map(row => row.eventKey)).size).toBe(3);
  });
  it("accepts only own bounded country/form attestation and audits changes", async () => {
    const f = await setup();
    expect(await f.t.query(api.tax.myProfile, { demoIdentity: "contributor" })).toMatchObject({ taxForm: "none" });
    const input = { demoIdentity: "contributor", country: "in", taxForm: "w8ben_on_file" as const };
    await f.t.mutation(api.tax.setProfile, input);
    expect(await f.t.query(api.tax.myProfile, { demoIdentity: "contributor" })).toMatchObject({ country: "IN", taxForm: "w8ben_on_file" });
    expect(await f.t.mutation(api.tax.setProfile, input)).toMatchObject({ replayed: true });
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(row => row.action === "contributor_tax_profile_attested")).toHaveLength(1);
    await expect(f.t.mutation(api.tax.setProfile, { ...input, demoIdentity: "finance-agent" })).rejects.toThrow("forbidden");
    await expect(f.t.mutation(api.tax.setProfile, { ...input, demoIdentity: "buyer" })).rejects.toThrow("forbidden");
    await expect(f.t.query(api.tax.summary, { demoIdentity: "contributor" })).rejects.toThrow("forbidden");
    await expect(f.t.mutation(api.tax.setProfile, { ...input, country: "ZZ" })).rejects.toThrow("invalid_iso_country");
  });
  it("has no tax PII fields: strict input and stored schema reject tax identifiers", async () => {
    const f = await setup();
    for (const field of ["ssn", "tin", "taxId", "identityDocument", "legalName", "formContents"]) {
      await expect(f.t.mutation(api.tax.setProfile, { demoIdentity: "contributor", country: "US", taxForm: "w9_on_file", [field]: "never-store-this" } as any)).rejects.toThrow();
      await expect(f.t.run(async ctx => {
        const member = (await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", contributor)).unique())!;
        await ctx.db.patch(member._id, { taxProfile: { country: "US", taxForm: "none", updatedAt: Date.now(), [field]: "never-store-this" } as any });
      })).rejects.toThrow();
    }
  });
  it("never lets the finance agent change tax status even with a misprovisioned contributor role", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const agent = (await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:finance-agent")).unique())!;
      await ctx.db.patch(agent._id, { roles: ["finance-agent", "contributor"] });
    });
    await expect(f.t.mutation(api.tax.setProfile, { demoIdentity: "finance-agent", country: "US", taxForm: "w9_on_file" })).rejects.toThrow("agent_tax_status_refused");
    expect((await f.t.query(api.tax.myProfile, { demoIdentity: "contributor" })).taxForm).toBe("none");
  });
});
describe("tax-ready ledger is a deterministic payment projection", () => {
  it("tags paid journals exactly, derives YTD once, and raises advisory without mutating approvals", async () => {
    const f = await setup(), { entryId, orderId } = await paid(f);
    const entry = (await f.t.run(ctx => ctx.db.get(entryId)))!;
    expect(entry).toMatchObject({ usdValueAtPayment: 600_000_000n, taxYear: new Date().getUTCFullYear() });
    const report = await f.t.query(api.tax.summary, { demoIdentity: "buyer" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ ytdMicroUsd: "600000000", payoutCount: 1, taxForm: "none", flags: ["tax_form_missing", "info_return_needed"] });
    expect(report.rows[0].contributorId).not.toContain("demo:");
    expect(report.csv).toContain('"600.000000"');
    expect(report.csv).toContain("Not tax advice — demo data");
    const journal = await f.t.query(api.dashboard.journal, { demoIdentity: "buyer", orderId });
    expect(journal.find(row => row._id === entryId)?.usdValueAtPayment).toBe("600000000");
    expect(() => JSON.stringify(journal)).not.toThrow();
    const queue = await f.t.query(api.exceptions.list, { demoIdentity: "buyer", orderId });
    expect(queue.some(row => row.exception.code === "info_return_needed")).toBe(true);
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
    expect(await f.t.query(api.tax.summary, { demoIdentity: "finance-agent", year: new Date().getUTCFullYear() - 1 })).toMatchObject({ rows: [expect.objectContaining({ ytdMicroUsd: "0", payoutCount: 0 })] });
  });
  it("uses UTC payout years across midnight, including legacy records", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-12-31T23:59:59.000Z"));
    const f = await setup(), { entryId } = await paid(f, 1234567n);
    expect((await f.t.run(ctx => ctx.db.get(entryId)))?.taxYear).toBe(2025);
    await f.t.run(ctx => ctx.db.patch(entryId, { taxYear: undefined, usdValueAtPayment: undefined }));
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    expect((await f.t.query(api.tax.summary, { demoIdentity: "buyer", year: 2025 })).rows[0]?.ytdMicroUsd).toBe("1234567");
    expect((await f.t.query(api.tax.summary, { demoIdentity: "buyer", year: 2026 })).rows[0]?.ytdMicroUsd).toBe("0");
  });
  it("excludes scenario lab postings and rejects a foreign order scope", async () => {
    const f = await setup(), { orderId } = await paid(f, 1234567n);
    await f.t.run(ctx => ctx.db.patch(orderId, { publicId: "scenario:tax-exclusion" }));
    expect((await f.t.query(api.tax.summary, { demoIdentity: "buyer" })).rows[0]?.ytdMicroUsd).toBe("0");
    const foreignOrderId = await f.t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Synthetic foreign organization", status: "active", createdByTokenIdentifier: "synthetic:foreign" });
      const { _id, _creationTime, ...terms } = (await ctx.db.get(orderId))!;
      return ctx.db.insert("orders", { ...terms, organizationId, publicId: "synthetic:foreign-order" });
    });
    await expect(f.t.query(api.tax.summary, { demoIdentity: "buyer", orderId: foreignOrderId })).rejects.toThrow("cross_organization_access");
    await expect(f.t.query(api.tax.summary, { demoIdentity: "finance-agent", orderId: foreignOrderId })).rejects.toThrow("cross_organization_access");
  });
  it("derives legacy tags from original lines and uses configurable threshold without withholding", async () => {
    const f = await setup(), { entryId } = await paid(f, 1234567n);
    await f.t.run(ctx => ctx.db.patch(entryId, { usdValueAtPayment: undefined, taxYear: undefined }));
    vi.stubEnv("SKARL_TAX_REPORTING_THRESHOLD_MICRO_USD", "1000000");
    expect(reportingThreshold()).toBe(1000000n);
    await f.t.mutation(api.tax.setProfile, { demoIdentity: "contributor", country: "US", taxForm: "w9_on_file" });
    const report = await f.t.query(api.tax.summary, { demoIdentity: "buyer" });
    expect(report.rows[0]).toMatchObject({ ytdMicroUsd: "1234567", flags: ["info_return_needed"] });
    expect(report.rows[0].notes[0]).toContain("information return");
    expect((await f.t.query(api.tax.contributorsNeedingForms, { demoIdentity: "finance-agent" })).rows).toEqual([]);
    expect(taxCsv(report.rows)).toContain('"1.234567"');
  });
});
