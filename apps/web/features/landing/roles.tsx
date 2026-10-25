import { SectionHeader } from "@/components/section-header";
import { ROLES } from "./evidence";
import { Reveal } from "./roles/reveal";

// Five roles side by side under one rule: what each can do, and the one thing it can't.
export function Roles() {
  return (
    <section id="roles" aria-labelledby="roles-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <Reveal>
          <SectionHeader id="roles-title" eyebrow="Roles" title="Who can do what on Skarl" />
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((r, i) => (
            <Reveal key={r.role} index={i} className="h-full">
              <div className="flex h-full flex-col gap-3 border-t border-haze pt-4">
                <span className="mono text-[12px] leading-none text-fog">{String(i + 1).padStart(2, "0")}</span>
                <span className="cut-regular text-[18px] leading-[1.2] text-ink">{r.role}</span>
                <span className="text-[15px] leading-[1.35] text-slate-700">{r.can}</span>
                <span className="text-[15px] leading-[1.35] text-slate-300">{r.cannot}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
