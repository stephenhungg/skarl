'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

// Adapted from the EasyUI receipt printer: same feed jitter, extrusion and serrated paper,
// restyled to the Skarl ramp (tone only, no borders or shadows) and turned into a slot so the
// paper can carry any content, such as a journal entry.

const ZIGZAG_TOP = '0,10 5,0 10,10 15,0 20,10 25,0 30,10 35,0 40,10 45,0 50,10 55,0 60,10 65,0 70,10 75,0 80,10 85,0 90,10 95,0 100,10';
const ZIGZAG_BOTTOM = '0,0 5,10 10,0 15,10 20,0 25,10 30,0 35,10 40,0 45,10 50,0 55,10 60,0 65,10 70,0 75,10 80,0 85,10 90,0 95,10 100,0';

export type PrinterState = 'idle' | 'printing' | 'completed';

export interface PaymentReceiptPrinterProps {
  /** Paper content. */
  children: React.ReactNode;
  /** Change this to feed a fresh sheet (for example the active step index). */
  printKey?: string | number;
  /** When false the printer waits in standby and nothing feeds. */
  active?: boolean;
  /** Short mono label on the housing. */
  deviceLabel?: string;
  /** Duration of the paper extrusion in seconds. */
  printDuration?: number;
  /** Render jagged serrated paper edges. */
  showCutEffect?: boolean;
  onPrintStart?: () => void;
  onPrintComplete?: () => void;
  className?: string;
  printerClassName?: string;
  receiptClassName?: string;
}

export const PaymentReceiptPrinter: React.FC<PaymentReceiptPrinterProps> = ({
  children,
  printKey = 0,
  active = true,
  deviceLabel = 'Journal',
  printDuration = 0.75,
  showCutEffect = true,
  onPrintStart,
  onPrintComplete,
  className,
  printerClassName,
  receiptClassName,
}) => {
  const reduce = useReducedMotionSafe();
  const [state, setState] = useState<PrinterState>(reduce ? 'completed' : 'idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(onPrintStart);
  const doneRef = useRef(onPrintComplete);
  startRef.current = onPrintStart;
  doneRef.current = onPrintComplete;

  const print = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (reduce) {
      setState('completed');
      doneRef.current?.();
      return;
    }
    setState('printing');
    startRef.current?.();
    timer.current = setTimeout(() => {
      setState('completed');
      doneRef.current?.();
    }, printDuration * 1000);
  }, [reduce, printDuration]);

  useEffect(() => {
    if (active) print();
  }, [active, printKey, print]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const printing = state === 'printing';
  const shown = reduce || state !== 'idle';

  return (
    <div className={cn('flex w-full flex-col items-center select-none', className)} role="region" aria-label={deviceLabel}>
      <div className="relative flex w-full flex-col items-center">
        {/* Housing */}
        <motion.div
          animate={printing && !reduce ? { x: [0, -0.6, 0.6, -0.4, 0.4, 0], y: [0, -0.2, 0.2, 0] } : { x: 0, y: 0 }}
          transition={{ repeat: printing ? Infinity : 0, duration: 0.18, ease: 'easeInOut' }}
          className={cn('relative z-20 w-full rounded-[12px] bg-haze px-3.5 pb-3.5 pt-3', printerClassName)}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="mono text-[12px] leading-none text-slate-700">{deviceLabel}</span>
            <span className="flex items-center gap-1.5 rounded-[6px] bg-mist px-1.5 py-[3px]">
              <motion.span
                animate={printing ? { opacity: [0.4, 1, 0.4] } : { opacity: 1 }}
                transition={{ repeat: printing ? Infinity : 0, duration: 0.8 }}
                className={cn('size-1.5 rounded-full', state === 'idle' ? 'bg-fog' : 'bg-accent')}
              />
            </span>
          </div>
          {/* Feed slot */}
          <div className="h-2.5 w-full rounded-full bg-slate-300/45" />
        </motion.div>

        {/* Paper, extruding from behind the slot */}
        <div className="relative z-10 -mt-2 flex w-full justify-center overflow-hidden pb-3 pt-1">
          <motion.div
            key={printKey}
            initial={reduce ? { y: 0, opacity: 1 } : { y: '-100%', opacity: 0.4 }}
            animate={shown ? { y: '0%', opacity: 1 } : { y: '-100%', opacity: 0.4 }}
            transition={{ duration: reduce ? 0.01 : printDuration, ease: [0.16, 1, 0.3, 1] }}
            className={cn('mono relative w-[94%] rounded-b-[6px] bg-paper px-5 pb-5 pt-5 text-left text-ink', receiptClassName)}
          >
            {showCutEffect && (
              <div className="absolute inset-x-0 top-0 h-1.5 -translate-y-full overflow-hidden">
                <svg className="h-1.5 w-full text-paper" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden>
                  <polygon fill="currentColor" points={ZIGZAG_TOP} />
                </svg>
              </div>
            )}
            {children}
            {showCutEffect && (
              <div className="absolute inset-x-0 bottom-0 h-1.5 translate-y-full overflow-hidden">
                <svg className="h-1.5 w-full text-paper" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden>
                  <polygon fill="currentColor" points={ZIGZAG_BOTTOM} />
                </svg>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

/** Dashed thermal-paper rule, drawn with a gradient rather than a border. */
export function ReceiptRule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('h-px w-full', className)}
      style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgb(var(--fog)) 0 4px, transparent 4px 8px)' }}
    />
  );
}
