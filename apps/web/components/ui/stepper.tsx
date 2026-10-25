"use client";

import * as React from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { cn } from "../../lib/utils";

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const fill = { duration: 0.35, ease: [0.32, 0.72, 0, 1] } as const;

export interface Step {
  title: string;
  description?: string;
}

export interface StepperProps {
  steps: Step[];
  /** Zero-based index of the active step. */
  current: number;
  /** Makes completed steps clickable (jump back). */
  onStepChange?: (index: number) => void;
  orientation?: "horizontal" | "vertical";
  /** "complete" (default) lets you jump back only; "all" makes every step a button. */
  clickable?: "complete" | "all";
  /** Number of steps lit so far. Steps at or past this index stay dimmed. Defaults to all. */
  lit?: number;
  className?: string;
}

export function Stepper({ steps, current, onStepChange, orientation = "horizontal", clickable: clickMode = "complete", lit, className }: StepperProps) {
  const uid = React.useId();
  const vertical = orientation === "vertical";
  const last = steps.length - 1;

  // don't replay the check-draw for steps that are already done on first paint
  const ready = React.useRef(false);
  React.useEffect(() => {
    ready.current = true;
  }, []);

  return (
    <ol aria-label="Progress" className={cn(vertical ? "flex flex-col" : "flex w-full items-center", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "complete" : i === current ? "current" : "upcoming";
        const clickable = !!onStepChange && (clickMode === "all" ? state !== "current" : state === "complete");
        const dark = lit !== undefined && i >= lit;

        const indicator = (
          <span
            className={cn(
              "mono isolate relative grid size-7 shrink-0 place-items-center rounded-full text-[12px] leading-none tabular-nums transition-colors duration-300",
              state === "complete" && "bg-slate-700 text-mist",
              state === "current" && "bg-accent text-accent-ink",
              state === "upcoming" && "bg-mist text-slate-500"
            )}
          >
            {state === "current" && (
              <motion.span
                layoutId={`${uid}-ring`}
                transition={spring}
                className="absolute -inset-[4px] rounded-full bg-[rgb(var(--accent)/.35)] -z-10"
              />
            )}
            {state === "complete" ? (
              <svg
                viewBox="0 0 24 24"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <motion.path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  initial={ready.current ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.3, delay: 0.08, ease: "easeOut" }}
                />
              </svg>
            ) : (
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
            )}
          </span>
        );

        const label = (
          <span
            className={cn(
              "flex min-w-0 flex-col text-left",
              !vertical && state !== "current" && "hidden sm:flex",
              vertical && "pt-[5px]"
            )}
          >
            <span
              className={cn(
                "cut-regular text-[16px] leading-[1.2] tracking-[0.01em] transition-colors duration-300",
                !vertical && "truncate",
                state === "current" ? "text-ink" : state === "complete" ? "text-deep" : "text-slate-500"
              )}
            >
              {step.title}
              {state === "complete" && <span className="sr-only"> (completed)</span>}
            </span>
            {step.description && (
              <span className={cn("mt-1.5 text-[14px] leading-[1.3] tracking-[0.01em] text-slate-500", !vertical && "truncate")}>{step.description}</span>
            )}
          </span>
        );

        const row = clickable ? (
          <button
            type="button"
            onClick={() => onStepChange!(i)}
            className={cn(
              "group flex cursor-pointer gap-3 rounded-[10px] text-left",
              vertical ? "items-start" : "items-center"
            )}
          >
            {indicator}
            {label}
          </button>
        ) : (
          <div className={cn("flex gap-3", vertical ? "items-start" : "items-center")}>
            {indicator}
            {label}
          </div>
        );

        return (
          <motion.li
            key={i}
            aria-current={state === "current" ? "step" : undefined}
            initial={false}
            animate={{ opacity: dark ? 0.32 : 1 }}
            transition={{ duration: 0.45, ease: [0.43, 0.42, 0.37, 0.97] }}
            className={cn(
              vertical ? "relative pb-6 last:pb-0" : "flex items-center",
              !vertical && i < last && "flex-1"
            )}
          >
            {row}

            {i < last && (
              <span
                aria-hidden
                className={cn(
                  "overflow-hidden bg-haze",
                  vertical ? "absolute bottom-1 left-[13.5px] top-[34px] w-px" : "relative mx-3 h-px flex-1"
                )}
              >
                <motion.span
                  initial={false}
                  animate={vertical ? { scaleY: i < current ? 1 : 0 } : { scaleX: i < current ? 1 : 0 }}
                  transition={fill}
                  className={cn(
                    "absolute inset-0 bg-slate-700",
                    vertical ? "origin-top" : "origin-left"
                  )}
                />
              </span>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}

/* ───────────── panels: slide in the direction you're travelling ───────────── */

const slide: Variants = {
  enter: (d: number) => ({ x: d * 24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d * -24, opacity: 0 }),
};

export interface StepPanelsProps {
  current: number;
  /** One child per step, in order. */
  children: React.ReactNode;
  className?: string;
}

export function StepPanels({
  current,
  children,
  className,
}: StepPanelsProps) {
  const panels = React.Children.toArray(children);
  const prev = React.useRef(current);
  const dir = current >= prev.current ? 1 : -1;
  React.useEffect(() => {
    prev.current = current;
  }, [current]);

  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={current}
          custom={dir}
          variants={slide}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        >
          {panels[current]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
