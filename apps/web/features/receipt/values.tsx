"use client";

import { useState } from "react";
import type { ReceiptValue } from "./data";
import { MediaIcon } from "./glyphs";

/** Monospace value with optional muted prefix, optional link and a Copy button. */
export function HashValue({
  v,
  prefix,
  href,
  copy,
  size = "mono text-[16px] leading-[1.4]",
}: {
  v: string;
  prefix?: string;
  href?: string;
  copy?: string;
  size?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {}
  };
  const body = (
    <span className="break-all">
      {prefix && <span className="text-slate-500">{prefix}</span>}
      <span className="text-ink">{v}</span>
    </span>
  );
  return (
    <span className={`inline-flex items-baseline gap-2 ${size}`}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-fog underline-offset-4 hover:decoration-ink transition-colors"
        >
          {body}
        </a>
      ) : (
        body
      )}
      {copy && (
        <button
          type="button"
          onClick={onCopy}
          className="mono text-[10px] uppercase tracking-[0.05em] whitespace-nowrap shrink-0 text-slate-500 hover:text-ink transition-colors"
          aria-label="Copy"
        >
          <span className="grid">
            <span className="col-start-1 row-start-1 invisible" aria-hidden="true">
              Copied
            </span>
            <span className="col-start-1 row-start-1">{copied ? "Copied" : "Copy"}</span>
          </span>
        </button>
      )}
    </span>
  );
}

/** Inner content of a Details value cell. */
export function CellValue({ val }: { val: ReceiptValue }) {
  switch (val.k) {
    case "text":
      return <>{val.v}</>;
    case "chip":
      return <span className="mono text-[16px] leading-[1.4] text-ink break-all rounded-[2px] bg-haze px-[.4em] py-[.1em] [box-decoration-break:clone]">{val.v}</span>;
    case "num":
      return <span className="mono text-[16px] leading-[1.4] text-ink tabular-nums">{val.v}</span>;
    case "status":
      return val.color === "accent" ? (
        <span className="rounded-[2px] bg-accent px-[.4em] py-[.1em] text-accent-ink">{val.v}</span>
      ) : (
        <span style={{ color: val.color }}>{val.v}</span>
      );
    case "date":
      return (
        <span className="inline-flex items-baseline gap-2 mono text-[16px] leading-[1.4] tabular-nums text-ink">
          <span>{val.date}</span>
          <span className="text-fog" aria-hidden="true">
            ·
          </span>
          <span>{val.time}</span>
          <span className="mono text-[10px] uppercase tracking-[0.05em] text-slate-500">{val.zone}</span>
        </span>
      );
    case "country":
      return (
        <>
          {val.v}
          <span className="text-slate-500">{val.sub}</span>
        </>
      );
    case "link":
      return (
        <a
          target="_blank"
          rel="noopener noreferrer"
          className={
            val.mono
              ? "mono text-[16px] leading-[1.4] underline decoration-fog underline-offset-4 hover:decoration-ink break-all"
              : "underline decoration-fog underline-offset-4 hover:decoration-ink"
          }
          href={val.href}
        >
          {val.v}
        </a>
      );
    case "media":
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-[2px]"
            style={{ color: val.color, backgroundColor: val.bg }}
          >
            <MediaIcon media={val.v.toLowerCase()} />
          </span>
          <span>{val.v}</span>
        </span>
      );
    case "hash":
      return <HashValue v={val.v} prefix={val.prefix} copy={val.copy} />;
    case "tx":
      return <HashValue v={val.v} prefix={val.prefix} href={val.href} copy={val.copy} />;
  }
}
