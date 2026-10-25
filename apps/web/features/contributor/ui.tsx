import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" };

// Same tone and size as components/button.tsx, but a real <button> for in-page actions.
export function ActionButton({ variant = "primary", className, children, type = "button", ...rest }: ActionProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cn(
        "cut-medium inline-flex h-10 select-none items-center justify-center gap-2 rounded-[10px] px-6 text-[16px] leading-none tracking-[0.01em] transition-colors duration-[400ms] ease-[var(--ease-hover)] disabled:cursor-not-allowed max-md:text-[14px]",
        variant === "primary" && "bg-slate-700 text-mist hover:bg-deep disabled:bg-haze disabled:text-slate-500",
        variant === "secondary" && "bg-mist text-deep hover:bg-haze disabled:text-fog disabled:hover:bg-mist",
        variant === "quiet" && "px-3 text-slate-500 hover:text-ink disabled:text-fog",
        className,
      )}
    >
      {children}
    </button>
  );
}

export type PillTone = "accent" | "neutral" | "muted" | "strong";
const PILL: Record<PillTone, string> = {
  accent: "bg-accent text-accent-ink",
  neutral: "bg-haze/60 text-slate-700",
  muted: "bg-haze/40 text-slate-500",
  strong: "bg-haze text-ink",
};

/** Mirrors components/status-pill.tsx for labels outside its fixed set. Tones sit on haze so they read on mist cards and paper rows. */
export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return <span className={cn("mono inline-flex shrink-0 items-center rounded-[6px] px-1.5 py-[3px] text-[12px] leading-none", PILL[tone], className)}>{children}</span>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[14px] leading-[1.2] tracking-[0.01em] text-slate-300", className)}>{children}</p>;
}

export function Card({ children, className, id, label }: { children: ReactNode; className?: string; id?: string; label?: string }) {
  return <section id={id} aria-label={label} className={cn("rounded-[12px] bg-mist p-6 max-md:p-[18px]", className)}>{children}</section>;
}

export function CardTitle({ step, children, aside }: { step: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <span className="mono text-[12px] leading-none text-slate-300">{step}</span>
        <h2 className="cut-regular text-[20px] leading-[1.2] text-deep md:text-[24px]">{children}</h2>
      </div>
      {aside}
    </div>
  );
}

export function shortHash(hash: string, size = 10) {
  return hash.length > size * 2 ? `${hash.slice(0, size)}…${hash.slice(-4)}` : hash;
}
