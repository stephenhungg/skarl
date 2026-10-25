"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./wordmark";

const LINKS = [
  { label: "How Skarl works", href: "/#how-it-works" },
  { label: "GitHub", href: "https://github.com/stephenhungg/skarl", external: true },
];

// Glass bar, 64px. Slides away while scrolling down past 120px, returns on any scroll up.
export function SiteNav() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last.current;
      last.current = y;
      if (y < 120 || dy < 0) setHidden(false);
      else if (dy > 0) setHidden(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 transition-transform duration-[550ms]"
      style={{ transform: hidden ? "translateY(-102%)" : "none", transitionTimingFunction: "cubic-bezier(.3,.35,.25,1)" }}
    >
      <div className="relative bg-[rgb(var(--paper)/.8)] backdrop-blur-[5px]">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
          <Link href="/" aria-label="Skarl home" className="flex w-[200px] items-center"><Wordmark /></Link>
          <nav className="hidden items-center md:flex" aria-label="Primary">
            {LINKS.map(link => (
              <Link key={link.label} href={link.href} {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="cut-regular px-6 py-3 text-[14px] leading-none tracking-[0.01em] text-ink transition-colors hover:text-slate-500">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex w-[200px] justify-end">
            <Link href="/dashboard" className="cut-regular inline-flex h-9 items-center rounded-[10px] bg-mist px-6 text-[14px] leading-none tracking-[0.01em] text-ink transition-colors duration-[400ms] hover:bg-haze">
              Open console
            </Link>
          </div>
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[rgb(var(--haze)/.7)]" />
      </div>
    </header>
  );
}
