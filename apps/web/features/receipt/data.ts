import receipts from "./receipts.json";

/** A value cell in the Details tables, the history proof lines and the lifecycle. */
export type ReceiptValue =
  | { k: "text"; v: string }
  | { k: "chip"; v: string }
  | { k: "num"; v: string }
  | { k: "status"; v: string; color: string }
  | { k: "date"; date: string; time: string; zone: string }
  | { k: "country"; v: string; sub: string }
  | { k: "link"; v: string; href: string; mono: boolean }
  | { k: "media"; v: string; color: string; bg: string }
  | { k: "hash"; v: string; prefix?: string; copy?: string }
  | { k: "tx"; v: string; href: string; prefix?: string; copy?: string };

export type ReceiptRow = { label: string; val: ReceiptValue };

export type LifecycleStep = {
  label: string;
  live: boolean;
  gap?: string;
  date?: string;
  time?: string;
  tx?: { v: string; href: string };
};

export type AssetReceipt = {
  id: string;
  /** Hero heading, e.g. "Image receipt". */
  title: string;
  app: { label: string; href: string };
  /** Per-receipt accent palette (custom properties on the receipt root). */
  vars: Record<string, string>;
  sourceId: string;
  stats: [string, string][];
  geo: { name: string; sub: string | null; code: string; label: string };
  capture: {
    kind: "ios" | "file";
    title: string;
    muted: string | null;
    specs: string[];
    motion?: { heading: number; north: boolean; speed: string | null; text: string };
  };
  contributor: {
    anonId: string;
    rows: { label: string; v: string; href?: string }[];
    consent: { label: string; recorded: string; title: string; text: string; href: string; aria: string }[];
  };
  lifecycle: { count: string; steps: LifecycleStep[] };
  groups: { summary: string; columns: { heading: string; empty?: string; rows: ReceiptRow[] }[] }[];
  history: {
    badge: string;
    entries: { seq: string; title: string; time: string; datetime: string; note: string; proof: ReceiptRow[] }[];
  };
  /** The full ledger record (what "Download JSON" saves). */
  record: {
    data_id: string;
    initial_metadata_json: { file: { content_sha256: string; media_category: string } } & Record<string, unknown>;
  } & Record<string, unknown>;
};

export const REFERENCE_ID = "ba6d011b-1051-5701-a368-c81ceb325b4f";

/** Folds a captured hue (0..360) into Skarl's lime and sage band (90..110) so every receipt keeps its own tint. */
export function skarlHue(raw: number): number {
  const h = ((raw % 360) + 360) % 360;
  return Math.round(90 + (h / 360) * 20);
}

/** Per-receipt palette, biased toward Skarl's lime accent. */
function skarlVars(raw: string): Record<string, string> {
  const h = skarlHue(Number(raw) || 0);
  return {
    "--receipt-hue": String(h),
    "--receipt-accent": `hsl(${h} 62% 64%)`,
    "--receipt-accent-ink": `hsl(${h} 42% 22%)`,
    "--receipt-accent-line": `hsl(${h} 26% 80%)`,
    "--receipt-tint": `hsl(${h} 34% 96%)`,
    "--receipt-highlight": `hsl(${h} 66% 76%)`,
    "--receipt-secondary": `hsl(${h + 40} 30% 66%)`,
  };
}

/** Status and media colors in the captured data, mapped to Skarl tokens. */
const COLOR_MAP: Record<string, string> = {
  "var(--color-moss)": "accent",
  "var(--color-status-caution)": "hsl(38 62% 38%)",
  "var(--color-cat-image)": "rgb(var(--accent-ink))",
  "color-mix(in srgb, var(--color-cat-image) 14%, transparent)": "rgb(var(--accent))",
};

/** The contributing app has no audit page here, so its links go to the app itself. */
const APP_HREF: Record<string, string> = { "/audit/skarl": "https://skarl.vercel.app" };

function toSkarl(r: AssetReceipt): AssetReceipt {
  const json = JSON.stringify(r).replace(/"(color|bg|href)":"([^"]*)"/g, (m, key: string, v: string) => {
    const next = key === "href" ? APP_HREF[v] : COLOR_MAP[v];
    return next ? `"${key}":"${next}"` : m;
  });
  const out = JSON.parse(json) as AssetReceipt;
  out.vars = skarlVars(r.vars["--receipt-hue"]);
  return out;
}

export const RECEIPTS = (receipts as unknown as AssetReceipt[]).map(toSkarl);

/** Unknown ids fall back to the reference receipt (this is a demo). */
export function getReceipt(id: string): AssetReceipt {
  return RECEIPTS.find((r) => r.id === id) ?? RECEIPTS.find((r) => r.id === REFERENCE_ID)!;
}

/** Inputs for the fingerprint visual, derived from the record. */
export function fingerprintSeed(r: AssetReceipt) {
  const file = r.record.initial_metadata_json.file;
  return {
    hash: `${r.id}:${file.content_sha256.replace(/^sha256:/, "")}`,
    media: file.media_category,
    hue: Number(r.vars["--receipt-hue"]),
    duration: 0,
  };
}
