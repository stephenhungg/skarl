"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Remounts its children when a WebGL canvas inside loses its context (GPU reset, sleep, hot reload),
// so a background shader comes back instead of staying blank.
export function ResilientCanvas({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let timer = 0;
    const onLost = (event: Event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setGeneration(g => g + 1), 250);
    };
    root.addEventListener("webglcontextlost", onLost, true);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("webglcontextlost", onLost, true);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      <div key={generation} className="h-full w-full">{children}</div>
    </div>
  );
}
