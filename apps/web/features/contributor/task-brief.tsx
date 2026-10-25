import { Check } from "lucide-react";
import { formatUsdc, type Criterion, type OrderSummary } from "./api";
import { Card, CardTitle, Pill, shortHash } from "./ui";

// Mirrors convex/seed.ts. Shown only when the live rubric can't be read, and labeled as such.
const DOC_TASK = {
  title: "Red-cup narrated demonstrations",
  taskPrompt: "Pick up the red cup and place it on the marked coaster while you narrate each action, with a fixed camera, red and blue cups and a 10 to 30 second clip.",
  criteria: [
    { criterionId: "red-cup-pickup", description: "Pick up the red cup", modality: "visual" },
    { criterionId: "coaster-placement", description: "Place the red cup on the marked coaster", modality: "temporal" },
    { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" },
  ] satisfies Criterion[],
};

const MODALITY: Record<Criterion["modality"], string> = { visual: "VISUAL", audio: "AUDIO", temporal: "TEMPORAL", cross_modal: "CROSS-MODAL" };

const ORDER_STATUS: Record<string, string> = {
  awaiting_funding: "The buyer has not funded this yet, so clips can be reviewed but nothing is accepted or paid until funding lands.",
  funded: "Funded and open.",
  collecting: "Funded and collecting.",
  fulfilled: "The quota is filled, so new clips won't be accepted.",
};

export function TaskBrief({ summary }: { summary: OrderSummary | null | undefined }) {
  const live = summary?.rubric ? summary : null;
  const title = live?.order.title ?? DOC_TASK.title;
  const prompt = (live?.rubric?.taskPrompt ?? DOC_TASK.taskPrompt).replace(/–/g, " to ");
  const criteria = live?.rubric?.criteria ?? DOC_TASK.criteria;
  const open = live ? Number(BigInt(live.order.quantityRequested) - BigInt(live.order.acceptedCount)) : null;

  return (
    <Card label="Task brief">
      <CardTitle step="01" aside={live ? <Pill tone="accent">LIVE RUBRIC</Pill> : <Pill tone="muted">{summary === undefined ? "LOADING" : "FROM DOCS"}</Pill>}>
        Task brief
      </CardTitle>
      <p className="cut-regular mt-5 text-[16px] leading-[1.2] tracking-[0.01em] text-ink md:text-[18px]">{title}</p>
      <p className="mt-2 text-[14px] leading-[1.4] tracking-[0.01em] text-slate-500 md:text-[16px]">{prompt}</p>

      <ul className="mt-5 flex flex-col gap-1.5">
        {criteria.map(criterion => (
          <li key={criterion.criterionId} className="flex items-start gap-3 rounded-[10px] bg-paper px-3 py-2.5">
            <Check aria-hidden className="mt-[1px] size-4 shrink-0 text-slate-300" strokeWidth={1.75} />
            <span className="flex-1 text-[14px] leading-[1.3] text-ink">{criterion.description}</span>
            <Pill tone="muted">{MODALITY[criterion.modality]}</Pill>
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] leading-[1.2]">
        <div>
          <dt className="text-slate-300">Pay per accepted clip</dt>
          <dd className="cut-regular mt-1 text-ink">{live ? `${formatUsdc(live.order.contributorRateAtomic)} test USDC` : "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-300">Open spots</dt>
          <dd className="cut-regular mt-1 text-ink">{open !== null && live ? `${open} of ${live.order.quantityRequested}` : "Unavailable"}</dd>
        </div>
        {live?.rubric && (
          <div className="col-span-2">
            <dt className="text-slate-300">Rubric version</dt>
            <dd className="mono mt-1 text-[12px] text-slate-700">v{live.rubric.version} · {shortHash(live.rubric.contentHash)}</dd>
          </div>
        )}
      </dl>

      {live && (
        <p className="mt-5 rounded-[10px] bg-haze/60 px-3 py-2.5 text-[13px] leading-[1.35] text-slate-700">
          {ORDER_STATUS[live.order.status] ?? `Order status: ${live.order.status.replace(/_/g, " ")}.`} Payouts are Base Sepolia test USDC.
        </p>
      )}
      {!live && summary !== undefined && (
        <p className="mt-5 text-[13px] leading-[1.35] text-slate-500">The live order isn&apos;t reachable, so this is the task as written in the docs and pay and open spots aren&apos;t shown.</p>
      )}
    </Card>
  );
}
