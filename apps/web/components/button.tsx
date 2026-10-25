import Link from "next/link";
import type { ReactNode } from "react";
import { CircleArrow } from "./arrow";

type Props = { href: string; children: ReactNode; variant?: "primary" | "secondary"; external?: boolean };

// Primary: slate-700 to deep. Secondary: mist to haze, with the blur-swap arrow.
export function Button({ href, children, variant = "primary", external }: Props) {
  const ext = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  if (variant === "primary") {
    return (
      <Link href={href} {...ext} className="cut-medium inline-flex h-10 items-center rounded-[10px] bg-slate-700 px-6 text-[16px] leading-none tracking-[0.01em] text-mist transition-colors duration-[400ms] ease-[var(--ease-hover)] hover:bg-deep">
        {children}
      </Link>
    );
  }
  return (
    <Link href={href} {...ext} className="btn-swap cut-medium relative inline-flex h-10 items-center overflow-hidden rounded-[10px] bg-mist pl-6 pr-10 text-[16px] leading-none tracking-[0.01em] text-deep transition-[background-color,padding] duration-[400ms] ease-[var(--ease-hover)] hover:bg-haze hover:pl-10 hover:pr-6">
      <CircleArrow className="btn-swap-in absolute left-4" />
      {children}
      <CircleArrow className="btn-swap-out absolute right-4" />
      <style>{`
        .btn-swap svg{transition:opacity .4s var(--ease-hover),filter .4s var(--ease-hover),transform .4s var(--ease-hover)}
        .btn-swap .btn-swap-in{opacity:0;filter:blur(8px);transform:translateX(-18px)}
        .btn-swap:hover .btn-swap-in{opacity:1;filter:blur(0);transform:none}
        .btn-swap:hover .btn-swap-out{opacity:0;filter:blur(8px);transform:translateX(18px)}
      `}</style>
    </Link>
  );
}
