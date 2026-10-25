'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { StatusPill, type EvidenceStatus } from '../status-pill';
import { cn } from '../../lib/utils';
import { motionTransitions } from '../../lib/motion-tokens';

// Adapted from the EasyUI payment status card: same badge pop, check draw and staggered detail
// rows, restyled to the Skarl ramp. It only ever claims what the status says. A transaction
// hash or explorer link renders only for a LIVE transfer that actually carries one.

export interface PaymentStatusRow {
  label: string;
  value: React.ReactNode;
}

export interface PaymentStatusProps {
  /** Evidence status of the transfer. Null means no money moves at this point. */
  status: EvidenceStatus | null;
  title: string;
  /** Formatted amount, already rendered from exact units by the caller. */
  amount?: string;
  /** Unit shown after the amount. */
  unit?: string;
  detail?: string;
  rows?: PaymentStatusRow[];
  /** Observed transaction hash. Ignored unless status is LIVE. */
  txHash?: string | null;
  /** Explorer link for txHash. Ignored unless status is LIVE. */
  txHref?: string | null;
  /** Re-runs the entrance when it changes. */
  animationKey?: string | number;
  className?: string;
}

function Badge({ status }: { status: EvidenceStatus | null }) {
  const reduce = useReducedMotion();
  const live = status === 'LIVE' || status === 'ACCEPTED';
  return (
    <motion.div
      initial={reduce ? false : { scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={motionTransitions.springSnappy}
      className={cn('grid size-10 shrink-0 place-items-center rounded-full', live ? 'bg-accent text-accent-ink' : 'bg-haze text-slate-700')}
      aria-hidden
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {live ? (
          <motion.path d="M20 6L9 17l-5-5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }} />
        ) : status === null ? (
          <path d="M6 12h12" />
        ) : (
          // Open dotted ring, static: nothing is in flight, so nothing spins.
          <circle cx="12" cy="12" r="7" strokeDasharray="0.1 4.3" strokeWidth={2.4} />
        )}
      </svg>
    </motion.div>
  );
}

export const PaymentStatus: React.FC<PaymentStatusProps> = ({
  status,
  title,
  amount,
  unit = 'USDC',
  detail,
  rows = [],
  txHash,
  txHref,
  animationKey,
  className,
}) => {
  const reduce = useReducedMotion();
  const live = status === 'LIVE';
  const showTx = live && !!txHash;

  return (
    <div className={cn('w-full rounded-[12px] bg-paper p-5', className)} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={animationKey ?? title}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.3, ease: [0.43, 0.42, 0.37, 0.97] }}
        >
          <div className="flex items-start gap-3.5">
            <Badge status={status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h3 className="cut-regular text-[16px] leading-[1.2] tracking-[0.01em] text-ink">{title}</h3>
                {status && <StatusPill status={status} />}
              </div>
              {detail && <p className="mt-1.5 text-[14px] leading-[1.3] tracking-[0.01em] text-slate-500">{detail}</p>}
            </div>
            {amount && (
              <span className="mono shrink-0 pt-0.5 text-[14px] leading-none text-ink tabular-nums">
                {amount} <span className="text-slate-500">{unit}</span>
              </span>
            )}
          </div>

          {(rows.length > 0 || showTx) && (
            <motion.dl
              initial="hidden"
              animate="shown"
              variants={{ shown: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.1 } } }}
              className="mt-4 space-y-2 rounded-[10px] bg-mist px-3.5 py-3"
            >
              {rows.map(row => (
                <motion.div
                  key={row.label}
                  variants={{ hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 6 }, shown: { opacity: 1, y: 0 } }}
                  transition={motionTransitions.springGentle}
                  className="flex items-baseline justify-between gap-4 text-[12px] leading-[1.3]"
                >
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="mono text-right text-slate-700">{row.value}</dd>
                </motion.div>
              ))}
              {showTx && (
                <motion.div variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }} className="flex items-baseline justify-between gap-4 text-[12px]">
                  <dt className="text-slate-500">Transaction</dt>
                  <dd className="mono min-w-0 truncate text-slate-700">
                    {txHref ? (
                      <a href={txHref} target="_blank" rel="noopener noreferrer" className="underline decoration-haze underline-offset-4 hover:text-deep">{txHash}</a>
                    ) : txHash}
                  </dd>
                </motion.div>
              )}
            </motion.dl>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
