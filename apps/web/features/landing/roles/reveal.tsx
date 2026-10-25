"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;

// M2 section reveal: fades up 12px once, when the top crosses 85% of the viewport.
// Pass an index to stagger items in a grid by 0.08s.
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      transition={reduce ? { duration: 0.2 } : { duration: 0.6, ease: SETTLE, delay: index * 0.08 }}
    >
      {children}
    </motion.div>
  );
}
