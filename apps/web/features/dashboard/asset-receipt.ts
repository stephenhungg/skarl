import { skarlHue, type AssetReceipt, type LifecycleStep, type ReceiptRow } from "@/features/receipt/data";
import type { AuditEvent, PayableRow, SubmissionRow } from "./data";
import { basescanTx, formatMs, formatUsdc, humanize, parseChainIdentity, shortHash } from "./format";

type Report = {
  pipeline?: { version?: string; status?: string; implementation?: string; modelRuns?: { provider: string; model: string }[] };
  criteria?: { criterionId: string; status: string }[];
  duplicate?: { status: string };
  recommendation?: string;
} | null;

export type ReceiptInput = {
  submission: SubmissionRow;
  report: { sourceHash?: string; verificationOnly?: boolean; report: unknown } | null;
  clip: { mimeType: string; durationMs: number | null } | null;
  audit: AuditEvent[];
  payable?: PayableRow;
  paidChainIdentity?: string;
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const clock = (ms: number) => `${new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

function vars(seed: string): Record<string, string> {
  let raw = 0;
  for (const char of seed) raw = (raw * 31 + char.charCodeAt(0)) % 360;
  const h = skarlHue(raw);
  return {
    "--receipt-hue": String(h), "--receipt-accent": `hsl(${h} 62% 64%)`, "--receipt-accent-ink": `hsl(${h} 42% 22%)`,
    "--receipt-accent-line": `hsl(${h} 26% 80%)`, "--receipt-tint": `hsl(${h} 34% 96%)`, "--receipt-highlight": `hsl(${h} 66% 76%)`,
    "--receipt-secondary": `hsl(${h + 40} 30% 66%)`,
  };
}

/**
 * The shared asset receipt, built only from this deployment's records for one clip:
 * its hash, verification run, human decision, audit trail and any reconciled payout.
 * Fields Skarl does not collect (location, device, KYC) say so instead of being filled in.
 */
export function toAssetReceipt({ submission, report, clip, audit, payable, paidChainIdentity }: ReceiptInput): AssetReceipt {
  const parsed = (report?.report ?? null) as Report;
  const sha = report?.sourceHash ?? submission.sourceHash ?? "";
  const events = audit.filter(e => e.entityId === submission._id || (payable && (e.entityId === payable._id || e.entityId === payable.intent?._id)))
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const at = (action: string) => events.find(e => e.action === action)?.occurredAt;
  const chain = parseChainIdentity(paidChainIdentity);

  const moment = (label: string, ms: number | undefined, tx?: LifecycleStep["tx"]): LifecycleStep =>
    ms ? { label, live: true, date: day(ms), time: clock(ms), tx } : { label, live: false };
  const steps: LifecycleStep[] = [
    moment("Recorded", submission._creationTime),
    moment("Hashed and queued", at("submission_queued")),
    moment("Verified by AI", at("analysis_stored") ?? submission.analysis?.completedAt),
    moment("Reviewed by a person", submission.decision?.decidedAt ?? at("submission_human_reviewed")),
    moment("Delivered to buyer", submission.delivery?.publishedAt),
    payable?.status === "paid" && chain
      ? { label: "Paid on Base Sepolia", live: true, tx: { v: shortHash(chain.txHash, 8, 6), href: basescanTx(chain.txHash) } }
      : { label: "Paid on Base Sepolia", live: false },
  ];

  const fileRows: ReceiptRow[] = [
    { label: "Content SHA-256", val: sha ? { k: "hash", v: shortHash(sha, 10, 8), copy: sha } : { k: "text", v: "Not hashed yet" } },
    { label: "Media", val: { k: "chip", v: clip?.mimeType.split(";")[0] ?? "video" } },
    { label: "Duration", val: { k: "num", v: clip?.durationMs ? formatMs(clip.durationMs) : "Unknown" } },
    { label: "License", val: { k: "text", v: report?.verificationOnly ? "None. Verification-only test upload" : "demo-consent-v1" } },
  ];
  const verificationRows: ReceiptRow[] = [
    { label: "Pipeline", val: { k: "text", v: `${parsed?.pipeline?.version ?? "None"} · ${humanize(parsed?.pipeline?.status ?? "pending")}` } },
    ...(parsed?.pipeline?.modelRuns ?? []).map((run, i) => ({ label: `Model ${i + 1}`, val: { k: "chip" as const, v: run.model } })),
    ...(parsed?.criteria ?? []).map(c => ({ label: humanize(c.criterionId), val: { k: "status" as const, v: humanize(c.status),
      color: c.status === "supported" ? "accent" : c.status === "contradicted" ? "hsl(8 62% 46%)" : "hsl(38 62% 38%)" } })),
    { label: "Copy check", val: { k: "text", v: humanize(parsed?.duplicate?.status ?? "not_checked") } },
    { label: "AI recommends", val: { k: "text", v: humanize(parsed?.recommendation ?? "pending") } },
  ];
  const moneyRows: ReceiptRow[] = [
    { label: "Payable", val: { k: "text", v: payable ? `${formatUsdc(payable.amountAtomic)} USDC · ${humanize(payable.status)}` : "None. Created only on accepted delivery" } },
    ...(chain ? [{ label: "Transfer", val: { k: "tx" as const, v: shortHash(chain.txHash, 8, 6), href: basescanTx(chain.txHash), copy: chain.txHash } }] : []),
  ];

  return {
    id: submission._id,
    title: "Video receipt",
    app: { label: "Skarl", href: "/dashboard" },
    vars: vars(sha || submission._id),
    sourceId: submission._id,
    stats: [["Media", "Video"], ["Duration", clip?.durationMs ? formatMs(clip.durationMs) : "Unknown"], ["Status", humanize(submission.status)]],
    geo: { name: "Not collected", sub: "Skarl does not record location", code: "", label: "Location" },
    capture: { kind: "file", title: "Browser recorder", muted: null, specs: [clip?.mimeType.split(";")[0] ?? "video", "Camera and microphone, one take"] },
    contributor: {
      anonId: shortHash(submission.contributorTokenIdentifier.replace(/^.*\|/, ""), 6, 4),
      rows: [{ label: "Identity", v: "Demo contributor account" }],
      consent: report?.verificationOnly ? [] : [{ label: "Training license", recorded: "Recorded at upload", title: "demo-consent-v1",
        text: "Licensed to the buyer for model training. The original stays in private storage.", href: "/contribute", aria: "Read the consent terms" }],
    },
    lifecycle: { count: `${steps.filter(s => s.live).length} of ${steps.length} recorded`, steps },
    groups: [{ summary: "File, verification and payment", columns: [
      { heading: "File and license", rows: fileRows },
      { heading: "Verification", rows: verificationRows },
      { heading: "Payment", rows: moneyRows },
    ] }],
    history: {
      badge: `${events.length} events`,
      entries: events.map((event, index) => ({
        seq: String(index + 1).padStart(2, "0"), title: humanize(event.action), time: `${day(event.occurredAt)}, ${clock(event.occurredAt)}`,
        datetime: new Date(event.occurredAt).toISOString(), note: event.reason,
        proof: [{ label: "Actor", val: { k: "text", v: `${event.actor.kind === "service" ? "Service" : "Human"} · ${event.actor.identity}` } }],
      })),
    },
    record: {
      data_id: submission._id,
      initial_metadata_json: { file: { content_sha256: sha ? `sha256:${sha}` : "", media_category: "video" }, status: submission.status,
        pipeline: parsed?.pipeline ?? null, recommendation: parsed?.recommendation ?? null },
      verificationOnly: report?.verificationOnly ?? false,
    },
  };
}
