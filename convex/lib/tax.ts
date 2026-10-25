import { taxReportingThreshold } from "./config.ts";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { digest } from "./finance";
import { POLICY_TOKEN } from "./demoAuth";

export const TAX_LABEL = "Not tax advice — demo data";
export const TAX_ASSUMPTION = "Assumption: USDC equals USD 1:1; values are integer micro-USD. UTC calendar year; demo advisory only.";
export const COUNTRY_NOTES: Readonly<Record<string, string>> = {
  IN: "Crypto transfers may be subject to TDS; seek local advice. No tax is computed or withheld.",
  US: "An information return may be required; seek advice for the applicable year and jurisdiction.",
};
export const TAX_COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
export function taxYear(value = new Date().getUTCFullYear()) {
  if (!Number.isInteger(value) || value < 1970 || value > 9999) throw new Error("invalid_tax_year");
  return value;
}
export function reportingThreshold(): bigint {
  // Thresholds change by year and jurisdiction. This configurable $600 demo default is not tax law.
  const raw = taxReportingThreshold();
  if (!/^[1-9][0-9]*$/.test(raw) || BigInt(raw) > 9223372036854775807n) throw new Error("invalid_tax_reporting_threshold");
  return BigInt(raw);
}
export async function payoutTotals(ctx: Pick<QueryCtx | MutationCtx, "db">, organizationId: Id<"organizations">, year: number) {
  const totals = new Map<string, { amount: bigint; count: number }>();
  const entries = await ctx.db.query("journalEntries").withIndex("by_org", q => q.eq("organizationId", organizationId)).collect();
  for (const entry of entries) {
    if (entry.kind !== "payout" || entry.status !== "posted" || (entry.taxYear ?? new Date(entry.effectiveAt).getUTCFullYear()) !== year) continue;
    const order = await ctx.db.get(entry.orderId);
    if (!order || order.organizationId !== organizationId) throw new Error("tax_order_binding_mismatch");
    if (order.publicId.startsWith("scenario:")) continue;
    if (!entry.contributorTokenIdentifier) throw new Error("tax_payout_contributor_required");
    const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
    if (lines.some(line => line.organizationId !== organizationId)) throw new Error("tax_journal_binding_mismatch");
    const amount = lines.filter(line => line.account === "asset:usdc").reduce((sum, line) => sum + (line.side === "credit" ? line.amountAtomic : -line.amountAtomic), 0n);
    if (amount <= 0n || entry.usdValueAtPayment !== undefined && entry.usdValueAtPayment !== amount) throw new Error("tax_payout_value_mismatch");
    const previous = totals.get(entry.contributorTokenIdentifier) ?? { amount: 0n, count: 0 };
    totals.set(entry.contributorTokenIdentifier, { amount: previous.amount + amount, count: previous.count + 1 });
  }
  return totals;
}
export type TaxException = { code: "info_return_needed"; eventKey: string; orderId: string; detail: string; message: string; advisory: true };
/** Informational exception only: never returns an approval failure or changes payment status. */
export async function recordTaxThresholdAdvisory(ctx: MutationCtx, input: { organizationId: Id<"organizations">; orderId: Id<"orders">; contributorTokenIdentifier: string; year: number }) {
  const total = (await payoutTotals(ctx, input.organizationId, input.year)).get(input.contributorTokenIdentifier)?.amount ?? 0n;
  const threshold = reportingThreshold();
  if (total < threshold) return;
  const eventKey = `tax:${input.year}:${digest(input.contributorTokenIdentifier)}`;
  const exception: TaxException = { code: "info_return_needed", eventKey, orderId: input.orderId, advisory: true,
    detail: `${TAX_LABEL}. Paid YTD ${total} micro-USD meets configurable demo threshold ${threshold}. ${TAX_ASSUMPTION}`,
    message: "Information return review may be needed; this advisory never blocks payment." };
  // Stable identity deduplicates repeated checks even as YTD grows.
  const exceptionKey = digest({ code: exception.code, eventKey, orderId: input.orderId });
  const prior = await ctx.db.query("reconciliationDispositions").withIndex("by_exception", q => q.eq("organizationId", input.organizationId).eq("orderId", input.orderId).eq("exceptionKey", exceptionKey)).unique();
  if (!prior) await ctx.db.insert("reconciliationDispositions", { organizationId: input.organizationId, orderId: input.orderId,
    exceptionKey, snapshotJson: JSON.stringify(exception), status: "acknowledged", reason: exception.message,
    actorTokenIdentifier: POLICY_TOKEN, updatedAt: Date.now() });
}
export type TaxRow = { contributorId: string; country: string | null; taxForm: "none" | "w9_on_file" | "w8ben_on_file"; updatedAt?: number; ytdMicroUsd: string; payoutCount: number; flags: string[]; notes: string[] };
export function rowFor(member: Doc<"memberships"> | undefined, token: string, total: { amount: bigint; count: number } | undefined): TaxRow {
  const taxForm = member?.taxProfile?.taxForm ?? "none", country = member?.taxProfile?.country ?? null;
  return { contributorId: member?._id ?? `contributor_${digest(token).slice(0, 16)}`, country, taxForm,
    ...(member?.taxProfile ? { updatedAt: member.taxProfile.updatedAt } : {}),
    ytdMicroUsd: (total?.amount ?? 0n).toString(), payoutCount: total?.count ?? 0,
    flags: [...(taxForm === "none" ? ["tax_form_missing"] : []), ...((total?.amount ?? 0n) >= reportingThreshold() ? ["info_return_needed"] : [])],
    notes: country && COUNTRY_NOTES[country] ? [COUNTRY_NOTES[country]] : [] };
}
const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function taxCsv(rows: TaxRow[]) {
  const dollars = (raw: string) => { const value = BigInt(raw); return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`; };
  return "contributor,country,form status,YTD USD,payout count,flags,label,assumption\r\n" + rows.map(row => [row.contributorId, row.country ?? "", row.taxForm, dollars(row.ytdMicroUsd), String(row.payoutCount), row.flags.join(";"), TAX_LABEL, TAX_ASSUMPTION].map(cell).join(",")).join("\r\n");
}
