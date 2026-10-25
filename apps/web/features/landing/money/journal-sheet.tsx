"use client";
import { useEffect, useState } from "react";
import { animate } from "motion/react";
import { ACCOUNTS, accountBalance, type Account } from "@skarl/ledger";
import { StatusPill } from "@/components/status-pill";
import { ReceiptRule } from "@/components/ui/payment-receipt-printer";
import { MONEY_ACCOUNT_LABEL, MONEY_LEDGER, type MoneyStep } from "../evidence";
import { centsAt, usdc } from "./amount";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

type Row = { account: Account; side: "debit" | "credit"; amount: bigint };

const FRAMES = 60;

/** Lines for the step: its journals, or the closing trial balance on the last step. */
function rowsFor(step: MoneyStep): Row[] {
  if (step.closing) {
    return (Object.keys(ACCOUNTS) as Account[]).map(account => {
      return { account, side: ACCOUNTS[account], amount: accountBalance(MONEY_LEDGER, account) };
    });
  }
  return step.journals.flatMap(journal => journal.lines.map(line => ({ account: line.account, side: line.debit > 0n ? "debit" : "credit", amount: line.debit || line.credit } as Row)));
}

/** One frame counter drives every figure, so the two totals are equal on every frame, not only the last. */
function useTick(key: string | number, run: boolean, delay: number) {
  const reduce = useReducedMotionSafe();
  const [frame, setFrame] = useState(reduce ? FRAMES : 0);
  useEffect(() => {
    if (reduce) {
      setFrame(FRAMES);
      return;
    }
    setFrame(0);
    if (!run) return;
    const controls = animate(0, FRAMES, { duration: 0.6, delay, ease: [0.43, 0.42, 0.37, 0.97], onUpdate: v => setFrame(Math.round(v)) });
    return () => controls.stop();
  }, [key, run, delay, reduce]);
  return frame;
}

function Amount({ micro, frame }: { micro: bigint; frame: number }) {
  if (micro === 0n) return <span className="text-fog">{usdc(0n)}</span>;
  return <>{usdc(centsAt(micro, frame, FRAMES))}</>;
}

export function JournalSheet({ step, index, total, run }: { step: MoneyStep; index: number; total: number; run: boolean }) {
  const rows = rowsFor(step);
  const debits = rows.reduce((sum, row) => sum + (row.side === "debit" ? row.amount : 0n), 0n);
  const credits = rows.reduce((sum, row) => sum + (row.side === "credit" ? row.amount : 0n), 0n);
  const frame = useTick(step.id, run, 0.35);
  const balanced = debits === credits;
  const done = frame >= FRAMES;

  return (
    <div className="text-[12px] leading-[1.3]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-500">{step.closing ? "Ending balances" : `Entry ${index + 1} of ${total}`}</span>
        <StatusPill status={step.journalStatus} />
      </div>
      <p className="cut-regular mt-2 text-[14px] leading-[1.25] tracking-[0.01em] text-ink">{step.title}</p>

      <ReceiptRule className="my-3" />

      {rows.length === 0 ? (
        <p className="text-slate-500">{step.note}</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1.5 tabular-nums">
            <span className="text-slate-500">Account</span>
            <span className="w-[60px] text-right text-slate-500">Debit</span>
            <span className="w-[60px] text-right text-slate-500">Credit</span>
            {rows.map((row, i) => (
              <div key={`${row.account}-${i}`} className="contents">
                <span className={row.amount === 0n ? "text-slate-500" : "text-ink"}>{MONEY_ACCOUNT_LABEL[row.account]}</span>
                <span className="text-right text-ink">{row.side === "debit" && <Amount micro={row.amount} frame={frame} />}</span>
                <span className="text-right text-ink">{row.side === "credit" && <Amount micro={row.amount} frame={frame} />}</span>
              </div>
            ))}
          </div>

          <ReceiptRule className="my-3" />

          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 tabular-nums">
            <span className="text-slate-700">Totals</span>
            <span className="w-[60px] text-right text-ink">{usdc(centsAt(debits, frame, FRAMES))}</span>
            <span className="w-[60px] text-right text-ink">{usdc(centsAt(credits, frame, FRAMES))}</span>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-slate-700" aria-live="polite">
            <span className={`inline-block size-1.5 rounded-full transition-colors duration-300 ${done && balanced ? "bg-accent" : "bg-haze"}`} aria-hidden />
            {balanced ? "Debits equal credits" : "Out of balance"}
          </p>
          {step.note && <p className="mt-2 text-slate-500">{step.note}</p>}
          {!step.closing && (
            <p className="mt-2 text-slate-500">{step.journals.map(journal => journal.description).join(". ")}.</p>
          )}
        </>
      )}
    </div>
  );
}
