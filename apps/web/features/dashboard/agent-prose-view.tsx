import { Fragment, type ReactNode } from "react";
import { agentProseBlocks } from "./agent-prose";

function inline(text: string): ReactNode {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>)]+)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="rounded bg-field px-1 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} className="font-medium text-text-1">{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link || /^https?:\/\//.test(part)) {
      const href = link?.[2] ?? part.replace(/[.,;:!?]+$/, "");
      return <Fragment key={i}><a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 [overflow-wrap:anywhere]">{link?.[1] ?? href}</a>{link ? null : part.slice(href.length)}</Fragment>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** React escapes all model text; only HTTP(S) links become anchors. No model HTML is executed. */
export function AgentProse({ text }: { text: string }) {
  return <div className="flex min-w-0 max-w-(--measure) flex-col gap-3 type-body text-text-1 [overflow-wrap:anywhere]">
    {agentProseBlocks(text).map((block, i) => {
      if (block.kind === "heading") return <p key={i} className="mt-1 font-medium">{inline(block.text)}</p>;
      if (block.kind === "code") return <pre key={i} className="overflow-x-auto rounded-panel bg-field p-3 type-body-sm"><code>{block.text}</code></pre>;
      if (block.kind === "list") {
        const List = block.ordered ? "ol" : "ul";
        return <List key={i} className={`flex flex-col gap-1.5 ps-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, j) => <li key={j} className="whitespace-pre-line">{inline(item)}</li>)}
        </List>;
      }
      return <p key={i} className="whitespace-pre-line">{inline(block.text)}</p>;
    })}
  </div>;
}

export function AgentAnswer({ explanation, checks, children }: { explanation?: string; checks?: ReactNode; children?: ReactNode }) {
  return <>
    {explanation ? <AgentProse text={explanation} /> : <p className="type-body text-text-2">The run finished without a written answer. See the tool checks for its recorded results.</p>}
    {children}
    {checks && <details className="rounded-panel border border-line-faint px-3 py-2 text-text-2">
      <summary className="cursor-pointer type-label-sm">View tool checks</summary>
      <div className="mt-3">{checks}</div>
    </details>}
  </>;
}
