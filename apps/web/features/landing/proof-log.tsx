import { ArrowGlyph } from "@/components/arrow";
import { SectionHeader } from "@/components/section-header";
import { StatusPill } from "@/components/status-pill";
import { EVIDENCE_DOCS_URL, PROOF_LOG, PROOF_NEXT, STATUS_LEGEND } from "./evidence";
import { PROOF_CSS, ProofRow } from "./proof/proof-row";
import { Reveal } from "./roles/reveal";

// Every row comes from evidence.ts and carries its status, so the log cannot claim more than ran.
export function ProofLog() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
      <style>{PROOF_CSS}</style>
      <Reveal>
        <SectionHeader id="proof-title" eyebrow="Status" title="What runs today" href={EVIDENCE_DOCS_URL} external />
      </Reveal>

      <Reveal className="mt-8">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-[12px] bg-[rgb(var(--mist)/0.5)] px-[18px] py-4 sm:grid-cols-2 md:px-6 xl:grid-cols-4">
          {STATUS_LEGEND.map((item) => (
            <div key={item.status} className="flex items-center gap-2.5">
              <dt className="flex-none"><StatusPill status={item.status} /></dt>
              <dd className="m-0 text-[13px] leading-[1.25] text-slate-500">{item.meaning}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      <Reveal className="mt-3">
        <ul className="m-0 flex list-none flex-col p-0">
          {PROOF_LOG.map((row) => (
            <ProofRow key={row.title} row={row} />
          ))}
        </ul>
        {PROOF_NEXT.length > 0 && (
          <>
            <p className="cut-book m-0 px-[18px] pb-1 pt-10 text-[14px] leading-[1.2] tracking-[0.01em] text-slate-500 md:px-6">Not running yet</p>
            <ul className="m-0 flex list-none flex-col p-0">
              {PROOF_NEXT.map((row) => (
                <ProofRow key={row.title} row={row} />
              ))}
            </ul>
          </>
        )}
      </Reveal>

      <div className="flex justify-end px-0 pt-6 md:px-6">
        <a href={EVIDENCE_DOCS_URL} target="_blank" rel="noopener noreferrer" className="pl-open cut-regular relative flex items-center py-2 pl-2 pr-[38px] text-[16px] leading-[1.2] text-slate-700 hover:text-deep">
          Browse our evidence
          <ArrowGlyph className="pl-open-a absolute top-1/2 -translate-y-1/2" />
          <ArrowGlyph className="pl-open-b absolute top-1/2 -translate-y-1/2" />
        </a>
      </div>
      </div>
    </section>
  );
}
