"use client";
import { useEffect, useState } from "react";
import { useReducedMotion as useMotionReduced } from "motion/react";

// Reports reduced motion only after mount, so server HTML and the first client render match.
export function useReducedMotionSafe(): boolean {
  const reduce = useMotionReduced();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!reduce;
}
