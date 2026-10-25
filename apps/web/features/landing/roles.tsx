"use client";
import { useState } from "react";
import { SectionHeader } from "@/components/section-header";

type Cell = "can" | "blocked" | "none";

const ACTIONS = ["Fund a task", "Record a clip", "Check a clip", "Draft a payout", "Approve a payout", "Get accepted clips"];

const ROLES: { role: string; who: string; cells: Cell[] }[] = [
  { role: "Buyer", who: "AI team", cells: ["can", "none", "none", "none", "blocked", "can"] },
  { role: "Contributor", who: "Person", cells: ["none", "can", "none", "none", "blocked", "none"] },
  { role: "Verifier", who: "AI", cells: ["none", "none", "can", "blocked", "blocked", "none"] },
  { role: "Finance agent", who: "AI", cells: ["none", "none", "none", "can", "blocked", "none"] },
  { role: "Controller", who: "Person", cells: ["none", "none", "none", "blocked", "can", "none"] },
];

const LABEL: Record<Cell, string> = { can: "can", blocked: "blocked", none: "not involved" };

function Mark({ cell, on }: { cell: Cell; on: boolean }) {
  if (cell === "can") {
    return (
      <span className={`grid size-7 place-items-center rounded-full bg-accent text-accent-ink transition-transform duration-300 ${on ? "scale-110" : ""}`}>
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  if (cell === "blocked") {
    return (
      <span className={`grid size-7 place-items-center rounded-full border border-dashed text-slate-500 transition-colors duration-300 ${on ? "border-ink text-ink" : "border-fog"}`}>
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </span>
    );
  }
  return <span className="size-1 rounded-full bg-haze" />;
}

// A permission grid: who can do each step, and the steps each role is deliberately kept out of.
export function Roles() {
  const [row, setRow] = useState<number | null>(null);
  const [col, setCol] = useState<number | null>(null);
  const lit = (r: number, c: number) => row === r || col === c;
  const dim = (r: number, c: number) => (row !== null || col !== null) && !lit(r, c);

  return (
    <section id="roles" aria-labelledby="roles-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="roles-title" eyebrow="Roles" title="Who can do what on Skarl" />
        <div className="mt-10 overflow-x-auto" onMouseLeave={() => { setRow(null); setCol(null); }}>
          <table className="w-full min-w-[760px] table-fixed border-collapse">
            <thead>
              <tr>
                <th className="w-[220px]" />
                {ACTIONS.map((a, c) => (
                  <th
                    key={a}
                    scope="col"
                    onMouseEnter={() => { setCol(c); setRow(null); }}
                    className={`cut-regular px-2 pb-4 text-center align-bottom text-[14px] font-normal leading-[1.25] transition-colors duration-300 ${col === c ? "text-ink" : "text-slate-500"}`}
                  >
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r, ri) => (
                <tr key={r.role} onMouseEnter={() => { setRow(ri); setCol(null); }} className="border-t border-haze">
                  <th scope="row" className="py-4 pr-4 text-left font-normal">
                    <span className={`cut-regular block text-[17px] leading-[1.2] transition-colors duration-300 ${row === ri ? "text-ink" : "text-deep"}`}>{r.role}</span>
                    <span className="mono mt-1 block text-[12px] leading-none text-slate-300">{r.who}</span>
                  </th>
                  {r.cells.map((cell, c) => (
                    <td
                      key={c}
                      onMouseEnter={() => { setRow(ri); setCol(c); }}
                      className={`py-4 text-center transition-opacity duration-300 ${dim(ri, c) ? "opacity-30" : ""}`}
                    >
                      <span className="inline-grid place-items-center" aria-label={`${r.role}: ${ACTIONS[c]}, ${LABEL[cell]}`} role="img">
                        <Mark cell={cell} on={lit(ri, c)} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-slate-500">
          <span className="flex items-center gap-2"><Mark cell="can" on={false} /> Can do it</span>
          <span className="flex items-center gap-2"><Mark cell="blocked" on={false} /> Blocked on purpose</span>
          <span>Whoever drafts a payout never approves it, and AI never approves anything.</span>
        </div>
      </div>
    </section>
  );
}
