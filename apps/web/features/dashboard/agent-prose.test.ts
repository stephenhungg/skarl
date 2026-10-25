import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentProseBlocks, readableAgentText } from "./agent-prose";
import { AgentAnswer, AgentProse } from "./agent-prose-view";

describe("finance answer presentation", () => {
  it("shows the answer before collapsed tool checks, while keeping proposals visible", () => {
    const html = renderToStaticMarkup(createElement(AgentAnswer, {
      explanation: "The payout has not been sent.", checks: createElement("p", null, "One payable is open"),
      children: createElement("a", { href: "/dashboard/payables" }, "Payout proposal"),
    }));
    expect(html.indexOf("The payout has not been sent.")).toBeLessThan(html.indexOf("Payout proposal"));
    expect(html.indexOf("Payout proposal")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("View tool checks");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).not.toContain("Show explanation");
  });

  it("does not invent an answer when a completed run has none", () => {
    expect(renderToStaticMarkup(createElement(AgentAnswer, {}))).toContain("without a written answer");
  });

  it("preserves all paragraphs around bullets, headings and numbered steps without blank lines", () => {
    expect(agentProseBlocks("## Summary\nNo payout yet.\n- Check the policy\n  Include its refusal\n- Review evidence\nStill waiting.\n1. Open Review\n2. Inspect the hold\nDo not send twice.")).toEqual([
      { kind: "heading", text: "Summary" }, { kind: "paragraph", text: "No payout yet." },
      { kind: "list", ordered: false, items: ["Check the policy\nInclude its refusal", "Review evidence"] },
      { kind: "paragraph", text: "Still waiting." },
      { kind: "list", ordered: true, items: ["Open Review", "Inspect the hold"] },
      { kind: "paragraph", text: "Do not send twice." },
    ]);
  });

  it("renders inline code, bold, numbered lists and evidence links instead of literal Markdown", () => {
    const url = `https://sepolia.basescan.org/tx/0x${"ab".repeat(32)}`;
    const html = renderToStaticMarkup(createElement(AgentProse, { text: `**Not sent.** Status is \`accrued\`.\n1. [View funding](${url})\n2. Review the policy` }));
    expect(html).toContain("<strong"); expect(html).toContain("<code"); expect(html).toContain("<ol");
    expect(html).toContain(`href="${url}"`); expect(html).toContain("noopener noreferrer");
    expect(html).not.toContain("**Not sent.**"); expect(html).not.toContain("`accrued`");
  });

  it("escapes model HTML, keeps code blocks as text, and never activates unsafe links", () => {
    const html = renderToStaticMarkup(createElement(AgentProse, { text: '<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n```html\n<script>alert(1)</script>\n```' }));
    expect(html).not.toContain("<img"); expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:'); expect(html).toContain("&lt;script&gt;");
  });

  it("keeps incomplete Markdown as text without dropping its final characters", () => {
    const html = renderToStaticMarkup(createElement(AgentProse, { text: "`accrued\n\n**Not sent\n\n```\nPending" }));
    expect(html).toContain("`accrued"); expect(html).toContain("**Not sent"); expect(html).toContain("Pending");
  });

  it("formats only explicit atomic money exactly, preserving ambiguous numbers and timestamps", () => {
    expect(readableAgentText("100000 micro-USDC; maxPerClipAtomic: 100000; amountAtomic: -1")).toBe("0.10 USDC; Cap per clip: 0.10 USDC; Amount: -0.000001 USDC");
    expect(readableAgentText("9,007,199,254,740,993 micro-USDC")).toBe("9,007,199,254.740993 USDC");
    expect(readableAgentText("1,000,000 records; cap 100000; timestamp 1792944324819")).toBe("1,000,000 records; cap 100000; timestamp 1792944324819");
    expect(readableAgentText("set at 1792944324819")).toBe(`set at ${new Date(1792944324819).toISOString().replace("T", " ").replace(/Z$/, " UTC")}`);
    expect(readableAgentText("`maxPerClipAtomic`: `100000`")).toBe("Cap per clip: 0.10 USDC");
  });

  it("preserves transaction and account evidence, including identifiers inside URLs", () => {
    const address = `0x${"ab".repeat(20)}`, hash = `0x${"ab".repeat(32)}`, id = "kh7c6cy844fyjxzpsg945v0c618gzsha";
    const url = `https://example.com/records/${id}`;
    const text = readableAgentText(`${address} ${hash} ${url} record ${id} asset:usdc`);
    expect(text).toContain(address); expect(text).toContain(hash); expect(text).toContain(url);
    expect(text).toContain("record this record USDC cash");
  });

  it("keeps sentence punctuation outside a bare transaction link", () => {
    const url = `https://sepolia.basescan.org/tx/0x${"ab".repeat(32)}`;
    const html = renderToStaticMarkup(createElement(AgentProse, { text: `Funding: ${url}. This is not a payout.` }));
    expect(html).toContain(`href="${url}"`); expect(html).toContain("</a>. This is not a payout.");
  });
});
