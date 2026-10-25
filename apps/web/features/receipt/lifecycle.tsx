import type { ReactNode } from "react";
import type { AssetReceipt, LifecycleStep } from "./data";
import { HashValue } from "./values";
import s from "./receipt.module.css";

const TIPS: Record<string, string> = {
  Captured: "The moment the contributor's device recorded this file, as reported in the provider's signed metadata.",
  Uploaded: "When the file left the contributor's device and reached the provider's platform.",
  Attested: "When the provider signed this record's metadata, locking in what it claims about the file.",
  Registered: "When Skarl accepted the record into Skarl's append-only audit log.",
  "Anchored on-chain": "The public blockchain transaction this receipt is anchored under. Open the hash to view it on the explorer.",
};

const ICONS: Record<string, ReactNode> = {
  Captured: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <circle className="lc-cap-dot" cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  Uploaded: (
    <>
      <path d="M5 18.5h14" />
      <g className="lc-up-arrow">
        <path d="M12 14.5V6" />
        <path d="M8.4 9.4 12 5.8l3.6 3.6" />
      </g>
    </>
  ),
  Attested: (
    <path
      className="lc-att-stroke"
      pathLength="1"
      d="M4.5 15.5c2.2-4.8 3.6-7.2 4.4-7.2.9 0 .2 7 1.6 7 1.3 0 2-4.4 3.2-4.4 1 0 .5 4.4 1.8 4.4.9 0 1.6-1.3 4-1.3"
    />
  ),
  Registered: (
    <>
      <rect x="6" y="3.75" width="12" height="16.5" rx="1" />
      <path className="lc-reg-line" d="M9 8.5h6" />
      <path className="lc-reg-line" style={{ animationDelay: "0.12s" }} d="M9 12h6" />
      <path className="lc-reg-line" style={{ animationDelay: "0.24s" }} d="M9 15.5h3.5" />
    </>
  ),
  "Anchored on-chain": (
    <>
      <g className="lc-link-a">
        <path d="M10.8 13.2a3.6 3.6 0 0 0 5.09 0l2.31-2.31a3.6 3.6 0 0 0-5.09-5.09l-1.32 1.32" />
      </g>
      <g className="lc-link-b">
        <path d="M13.2 10.8a3.6 3.6 0 0 0-5.09 0L5.8 13.11a3.6 3.6 0 0 0 5.09 5.09l1.32-1.32" />
      </g>
    </>
  ),
};

const slug = (label: string) => label.split(" ")[0].toLowerCase();

function Step({ step, last }: { step: LifecycleStep; last: boolean }) {
  const key = slug(step.label);
  return (
    <li
      className={`group relative flex min-w-0 items-start gap-4 pb-10 last:pb-0 lg:block lg:flex-1 lg:pb-0 lg:pr-6 lg:last:pr-0${step.live ? " lc-live" : ""}`}
    >
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-5 top-11 bottom-1 w-px bg-haze lg:left-12 lg:right-3 lg:top-5 lg:bottom-auto lg:h-px lg:w-auto"
        >
          {step.gap && (
            <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 bg-paper px-1.5 mono text-[10px] leading-[1.4] tabular-nums lg:block text-slate-500">
              {step.gap}
            </span>
          )}
        </span>
      )}
      <span
        tabIndex={0}
        aria-label={step.label}
        aria-describedby={`lifecycle-tip-${key}`}
        className="lc-tile relative flex size-10 shrink-0 items-center justify-center rounded-[2px] outline-none transition-colors duration-200 border border-haze bg-paper text-ink group-hover:border-ink focus-visible:border-ink"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {ICONS[step.label]}
        </svg>
      </span>
      <span className="min-w-0 flex-1 lg:flex-none lg:grid lg:pt-4">
        <span className="flex min-w-0 flex-col gap-1.5 pt-1 transition-opacity duration-200 lg:col-start-1 lg:row-start-1 lg:pt-0 lg:group-hover:opacity-0 lg:group-focus-within:opacity-0">
          <span className="mono text-[10px] uppercase tracking-[0.05em] text-slate-500">{step.label}</span>
          {step.tx ? (
            <HashValue v={step.tx.v} href={step.tx.href} size="mono text-[12px] leading-[1.4]" />
          ) : (
            <span className="flex flex-col gap-0.5">
              <span className="mono text-[12px] leading-[1.4] text-ink tabular-nums">{step.date}</span>
              <span className="mono text-[10px] leading-[1.4] text-slate-500 tabular-nums">{step.time}</span>
            </span>
          )}
        </span>
        <span
          role="tooltip"
          id={`lifecycle-tip-${key}`}
          className="pointer-events-none absolute left-14 top-0 z-10 w-64 max-w-[70vw] translate-y-1 rounded-[2px] border border-haze bg-paper p-3 cut-book text-[12px] tracking-[0.02em] leading-[1.2] text-ink opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 lg:static lg:col-start-1 lg:row-start-1 lg:w-auto lg:max-w-none"
        >
          {step.tx ? (
            <span className="flex flex-col gap-1.5">
              <span>{TIPS[step.label]}</span>
              <HashValue v={step.tx.v} href={step.tx.href} size="mono text-[10px] leading-[1.4]" />
            </span>
          ) : (
            TIPS[step.label]
          )}
        </span>
      </span>
    </li>
  );
}

export function Lifecycle({ receipt }: { receipt: AssetReceipt }) {
  const steps = receipt.lifecycle.steps;
  return (
    <div className={s.lifecycle}>
      <section className="px-5 md:px-10 lg:px-20 pb-10 md:pb-12 lg:pb-16">
        <div className="border-t border-haze pt-10 md:pt-12 lg:pt-16 flex flex-col gap-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h2 className="cut-regular text-[clamp(24px,3.5vw,32px)] tracking-[-0.03em] leading-[0.95] text-ink inline-flex items-baseline gap-2">
                Data lifecycle
                <span
                  tabIndex={0}
                  className="group relative inline-flex items-center align-middle cursor-help outline-none text-slate-300 hover:text-ink focus-visible:text-ink transition-colors"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  >
                    <circle cx="8" cy="8" r="5.75" />
                    <path d="M8 7.4v3.1" />
                    <path d="M8 5.4v.01" />
                  </svg>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-64 rounded-[2px] bg-ink px-3 py-2 cut-book text-[12px] tracking-[0.02em] leading-[1.2] normal-case tracking-normal text-paper opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    A step fills in when the record carries that moment. Capture, upload, and attestation come from the provider&apos;s signed metadata;
                    registration and the on-chain anchor follow as the record moves through Skarl. A dashed step means the record doesn&apos;t carry
                    that moment yet. Hover a step for what it means.
                  </span>
                </span>
              </h2>
            </div>
            <p className="mono text-[10px] uppercase tracking-[0.05em] text-slate-500 tabular-nums">{receipt.lifecycle.count}</p>
          </div>
          <ol className="flex flex-col lg:flex-row">
            {steps.map((step, i) => (
              <Step key={step.label} step={step} last={i === steps.length - 1} />
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
