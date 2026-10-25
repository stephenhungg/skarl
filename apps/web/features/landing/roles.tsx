"use client";
import { useEffect, useRef, useState } from "react";
import { SectionHeader } from "@/components/section-header";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

type Node = { id: string; label: string; tag?: string; x: number; y: number; kind: "person" | "ai" | "thing" };

const W = 1200, H = 540, NW = 190, NH = 60;

const NODES: Node[] = [
  { id: "buyer", label: "Buyer", tag: "Person", x: 150, y: 80, kind: "person" },
  { id: "task", label: "Task", x: 600, y: 80, kind: "thing" },
  { id: "contributor", label: "Contributor", tag: "Person", x: 1050, y: 80, kind: "person" },
  { id: "verifier", label: "Verifier", tag: "AI", x: 600, y: 240, kind: "ai" },
  { id: "agent", label: "Finance agent", tag: "AI", x: 200, y: 380, kind: "ai" },
  { id: "policy", label: "Buyer-signed rule", tag: "Deterministic", x: 1000, y: 380, kind: "thing" },
  { id: "payout", label: "Payout", x: 1000, y: 500, kind: "thing" },
];

// Edges in the order work moves through Skarl. `d` is the path, `lx/ly` where its label sits.
const EDGES: { id: string; d: string; label: string; lx: number; ly: number }[] = [
  { id: "fund", d: `M${150 + NW / 2},80 L${600 - NW / 2},80`, label: "funds", lx: 375, ly: 66 },
  { id: "record", d: `M${1050 - NW / 2},80 L${600 + NW / 2},80`, label: "records a clip", lx: 825, ly: 66 },
  { id: "check", d: `M600,${80 + NH / 2} L600,${240 - NH / 2}`, label: "clip", lx: 618, ly: 165 },
  { id: "evidence", d: `M${600 + NW / 2},240 C820,240 1000,260 1000,${380 - NH / 2}`, label: "evidence", lx: 860, ly: 232 },
  { id: "draft", d: `M${200 + NW / 2},380 L${1000 - NW / 2},380`, label: "drafts payout", lx: 600, ly: 366 },
  { id: "approve", d: `M1000,${380 + NH / 2} L1000,${500 - NH / 2}`, label: "approves", lx: 1018, ly: 445 },
  { id: "pay", d: `M${1000 + NW / 2},500 C1170,500 1170,${80 + NH / 2 + 60} 1090,${80 + NH / 2}`, label: "pays", lx: 1150, ly: 300 },
];

// The one thing the diagram exists to show: the agent that drafts a payout can't approve it.
const BLOCKED = { d: `M200,${380 + NH / 2} C200,470 600,500 ${1000 - NW / 2},500`, label: "can't approve its own payout", lx: 470, ly: 492 };

const STEP_MS = 1100;

export function Roles() {
  const reduce = useReducedMotionSafe();
  const [active, setActive] = useState(-1);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const dot = useRef<SVGCircleElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    let raf = 0, visible = false;
    const start = performance.now();
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    if (root.current) io.observe(root.current);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const total = (EDGES.length + 1) * STEP_MS; // one beat of rest before looping
      const t = (now - start) % total;
      const i = Math.floor(t / STEP_MS);
      const p = Math.min(1, (t % STEP_MS) / (STEP_MS * 0.8));
      setActive(prev => (prev === i ? prev : i));
      const path = paths.current[i];
      const c = dot.current;
      if (!c) return;
      if (!path) { c.setAttribute("opacity", "0"); return; }
      const len = path.getTotalLength();
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const pt = path.getPointAtLength(len * e);
      c.setAttribute("cx", String(pt.x));
      c.setAttribute("cy", String(pt.y));
      c.setAttribute("opacity", "1");
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [reduce]);

  return (
    <section id="roles" aria-labelledby="roles-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="roles-title" eyebrow="Roles" title="Who can do what on Skarl" />
        <p className="mt-4 max-w-3xl leading-relaxed text-slate-700">Two people: buyer and contributor. The agent proposes; the buyer-signed policy or the buyer in review approves; an independent CDP cap guards execution.</p>
        <div ref={root} className="mt-10 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[720px]" role="img"
            aria-label="Buyer funds a task, a contributor records a clip, the AI verifier supplies evidence, the finance agent drafts a payout, the buyer-signed deterministic rule approves it within its cap and the contributor is paid. The finance agent can't approve its own payout.">
            <defs>
              <marker id="roles-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9" fill="none" stroke="rgb(var(--slate-300))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              <marker id="roles-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9" fill="none" stroke="rgb(var(--slate-700))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>

            {/* blocked path */}
            <path d={BLOCKED.d} fill="none" stroke="rgb(var(--fog))" strokeWidth="1.5" strokeDasharray="5 6" />
            <g transform={`translate(${BLOCKED.lx} ${BLOCKED.ly})`}>
              <circle r="11" fill="rgb(var(--paper))" stroke="rgb(var(--slate-500))" strokeWidth="1.2" />
              <path d="m-4,-4 8,8 m0,-8 -8,8" stroke="rgb(var(--slate-700))" strokeWidth="1.5" strokeLinecap="round" />
              <text x="0" y="32" textAnchor="middle" className="cut-book" fontSize="15" fill="rgb(var(--slate-500))">{BLOCKED.label}</text>
            </g>

            {/* edges */}
            {EDGES.map((e, i) => {
              const on = i === active;
              return (
                <g key={e.id}>
                  <path
                    ref={el => { paths.current[i] = el; }}
                    d={e.d}
                    fill="none"
                    stroke={on ? "rgb(var(--slate-700))" : "rgb(var(--haze))"}
                    strokeWidth={on ? 2 : 1.5}
                    markerEnd={on ? "url(#roles-arrow-on)" : "url(#roles-arrow)"}
                    style={{ transition: "stroke .3s, stroke-width .3s" }}
                  />
                  <text x={e.lx} y={e.ly} textAnchor={e.id === "check" || e.id === "approve" ? "start" : "middle"} className="cut-book" fontSize="15"
                    fill={on ? "rgb(var(--ink))" : "rgb(var(--slate-500))"} style={{ transition: "fill .3s" }}>
                    {e.label}
                  </text>
                </g>
              );
            })}

            {/* travelling pulse */}
            {!reduce && <circle ref={dot} r="6" fill="rgb(var(--accent))" stroke="rgb(var(--accent-ink))" strokeWidth="1" opacity="0" />}

            {/* nodes */}
            {NODES.map(n => {
              const thing = n.kind === "thing";
              return (
                <g key={n.id} transform={`translate(${n.x - NW / 2} ${n.y - NH / 2})`}>
                  <rect width={NW} height={NH} rx={thing ? 30 : 14}
                    fill={thing ? "rgb(var(--paper))" : n.kind === "ai" ? "rgb(var(--ink))" : "rgb(var(--mist))"}
                    stroke={thing ? "rgb(var(--haze))" : "none"} strokeWidth="1.5" strokeDasharray={thing ? "0" : undefined} />
                  <text x={n.tag ? 18 : NW / 2} y={n.tag ? 27 : 36} textAnchor={n.tag ? "start" : "middle"} className="cut-regular" fontSize="18"
                    fill={n.kind === "ai" ? "rgb(var(--paper))" : "rgb(var(--ink))"}>
                    {n.label}
                  </text>
                  {n.tag && (
                    <text x="18" y="46" className="mono" fontSize="12" fill={n.kind === "ai" ? "rgb(var(--accent))" : "rgb(var(--slate-500))"}>
                      {n.tag}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}
