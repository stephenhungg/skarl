"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./wordmark";

// Just the wordmark and one button, no bar. Light over the dark hero, dark once past it.
// Slides away while scrolling down past 120px and returns on any scroll up.
export function SiteNav() {
  const [hidden, setHidden] = useState(false);
  const [onDark, setOnDark] = useState(true);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last.current;
      last.current = y;
      if (y < 120 || dy < 0) setHidden(false);
      else if (dy > 0) setHidden(true);
      const hero = document.getElementById("hero");
      setOnDark(!!hero && hero.getBoundingClientRect().bottom > 64);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 transition-[transform,opacity] duration-[550ms]"
      style={{ transform: hidden ? "translateY(-102%)" : "none", opacity: hidden ? 0 : 1, transitionTimingFunction: "cubic-bezier(.3,.35,.25,1)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
        <Link href="/" aria-label="Skarl home" className="flex items-center">
          <Wordmark color={onDark ? "rgb(var(--paper))" : "rgb(var(--ink))"} />
        </Link>
        <Link
          href="/dashboard"
          className={`cut-regular inline-flex h-9 items-center rounded-[10px] px-5 text-[14px] leading-none tracking-[0.01em] transition-colors duration-[400ms] ${onDark ? "bg-[rgb(var(--paper)/.1)] text-paper hover:bg-[rgb(var(--paper)/.18)]" : "bg-mist text-ink hover:bg-haze"}`}
        >
          Open console
        </Link>
      </div>
    </header>
  );
}
