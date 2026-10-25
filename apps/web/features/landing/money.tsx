"use client";
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { SectionHeader } from "@/components/section-header";
import { Stepper } from "@/components/ui/stepper";
import { PaymentReceiptPrinter } from "@/components/ui/payment-receipt-printer";
import { PaymentStatus } from "@/components/ui/payment-status";
import { MONEY_CASH_LEFT, MONEY_SEATS, MONEY_STEPS } from "./evidence";
import { JournalSheet } from "./money/journal-sheet";
import { usdc } from "./money/amount";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

const LIGHT_STAGGER_MS = 120; // M8: steps light in order
const DWELL_MS = 3600; // time on each step while the walkthrough plays itself

const STEPS = MONEY_STEPS.map(step => ({ title: step.title, description: step.detail }));

export function Money() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const visible = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotionSafe();
  const [lit, setLit] = useState(0);
  const [current, setCurrent] = useState(0);
  const [touched, setTouched] = useState(false);

  // Light the steps one after another the first time the section scrolls in.
  useEffect(() => {
    if (reduce) {
      setLit(STEPS.length);
      return;
    }
    if (!seen) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setLit(n);
      if (n >= STEPS.length) clearInterval(id);
    }, LIGHT_STAGGER_MS);
    return () => clearInterval(id);
  }, [seen, reduce]);

  // Then walk the order once, unless the reader takes over or looks away. Reduced motion never auto-advances.
  const allLit = lit >= STEPS.length;
  useEffect(() => {
    if (reduce || touched || !visible || !allLit || current >= STEPS.length - 1) return;
    const id = setTimeout(() => setCurrent(c => Math.min(c + 1, STEPS.length - 1)), DWELL_MS);
    return () => clearTimeout(id);
  }, [reduce, touched, visible, allLit, current]);

  const step = MONEY_STEPS[current]!;
  const transfer = step.transfer;

  return (
    <section id="money" aria-labelledby="money-title" className="py-[72px] min-[810px]:py-[108px]">
      <div className="frame">
        <SectionHeader id="money-title" eyebrow="Payments" title="How Skarl pays out a test order" href="https://github.com/stephenhungg/skarl/blob/main/docs/accounting.md" external />

        <div ref={ref} className="mt-8 grid gap-8 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,460px)] min-[1024px]:gap-12">
          <div className="min-w-0">
            <Stepper
              steps={STEPS}
              current={current}
              lit={lit}
              orientation="vertical"
              clickable="all"
              onStepChange={i => {
                setTouched(true);
                setCurrent(i);
              }}
            />
            <p className="mt-8 max-w-[520px] text-[14px] leading-[1.3] tracking-[0.01em] text-slate-500">{MONEY_SEATS}</p>
          </div>

          <div className="min-w-0 rounded-[12px] bg-mist p-3 min-[810px]:p-4">
            <PaymentReceiptPrinter printKey={step.id} active={seen} deviceLabel="Journal" receiptClassName="min-h-[300px]">
              <JournalSheet step={step} index={current} total={MONEY_STEPS.length} run={seen} />
            </PaymentReceiptPrinter>

            <PaymentStatus
              className="mt-1"
              animationKey={step.id}
              status={transfer ? transfer.status : null}
              title={transfer ? transfer.label : step.closing ? "Cash on hand" : "No transfer at this step"}
              amount={transfer ? usdc(transfer.amountMicro) : step.closing ? usdc(MONEY_CASH_LEFT) : undefined}
              detail={transfer ? transfer.detail : step.idleNote}
              txHref={transfer?.txHref ?? null}
              rows={transfer ? [
                { label: "Network", value: "Base Sepolia" },
                { label: "Signature", value: transfer.status === "LIVE" && transfer.txHref ? "Observed" : "None yet" },
              ] : []}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
