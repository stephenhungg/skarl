import { formatUsdc, humanize } from "./format";

const ACCOUNTS: Record<string, string> = {
  "asset:usdc": "USDC cash", "liability:customer_prepayments": "Customer prepayments",
  "liability:contributor_payables": "Contributor payables", "liability:customer_refunds": "Refunds payable",
  "revenue:dataset_sales": "Dataset sales", "expense:contributor_acquisition": "Contributor cost",
};
const AMOUNTS: Record<string, string> = {
  amountAtomic: "Amount", maxPerClipAtomic: "Cap per clip", pricePerSampleAtomic: "Price per clip",
  contributorRateAtomic: "Contributor rate", proposedAtomic: "Proposed amount",
};

/** Only convert explicitly labelled atomic money. A large number alone is not evidence of its unit. */
export function readableAgentText(text: string): string {
  // URLs are evidence: never rewrite a transaction hash or an identifier inside one.
  return text.split(/(https?:\/\/[^\s<>]+)/g).map(part => /^https?:\/\//.test(part) ? part : part
    .replace(/(-?\d[\d,]*)\s+(?:micro-USDC|microUSDC|micro USDC|atomic USDC)\b/gi,
      (_, value: string) => `${formatUsdc(value.replaceAll(",", ""))} USDC`)
    .replace(/`?\b(amountAtomic|maxPerClipAtomic|pricePerSampleAtomic|contributorRateAtomic|proposedAtomic)\b`?\s*[:=]\s*`?(-?\d[\d,]*)\b`?/g,
      (_, field: string, value: string) => `${AMOUNTS[field]}: ${formatUsdc(value.replaceAll(",", ""))} USDC`)
    .replace(/\b(asset|liability|revenue|expense):[a-z_]+\b/g, code => ACCOUNTS[code] ?? humanize(code.split(":")[1]!))
    .replace(/\b(set at|created at|updated at)\s+(\d{13})\b/gi, (_, label: string, timestamp: string) =>
      `${label} ${new Date(Number(timestamp)).toISOString().replace("T", " ").replace(/Z$/, " UTC")}`)
    .replace(/\b(?!0x)[a-z0-9]{32}\b/g, "this record")
  ).join("");
}

export type ProseBlock =
  | { kind: "paragraph" | "heading" | "code"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

/** Small, text-only Markdown subset. Keep trailing paragraphs and list continuations instead of dropping them. */
export function agentProseBlocks(text: string): ProseBlock[] {
  const lines = readableAgentText(text).replaceAll("\r\n", "\n").split("\n");
  const blocks: ProseBlock[] = [];
  const listItem = (line: string) => /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ kind: "heading", text: line.replace(/^#{1,6}\s+/, "") }); i++;
    } else if (listItem(line)) {
      const ordered = !listItem(line)![1];
      const items: string[] = [];
      while (i < lines.length) {
        const match = listItem(lines[i]!);
        if (match) {
          if ((!match[1]) !== ordered) break;
          items.push(match[2]!); i++;
        } else if (/^\s+\S/.test(lines[i]!) && items.length && !/^\s*```/.test(lines[i]!)) {
          items[items.length - 1] += `\n${lines[i++]!.trim()}`;
        } else break;
      }
      blocks.push({ kind: "list", ordered, items });
    } else {
      const paragraph: string[] = [line]; i++;
      while (i < lines.length && lines[i]!.trim() && !listItem(lines[i]!) && !/^(?:#{1,6}\s+|\s*```)/.test(lines[i]!)) {
        paragraph.push(lines[i++]!);
      }
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    }
  }
  return blocks;
}
