import { SectionHeader } from "@/components/section-header";
import { StatusPill } from "@/components/status-pill";
import { ROLE_INVARIANTS, ROLES } from "./evidence";
import { Reveal } from "./roles/reveal";
import { ROLE_TILE_CSS, RoleTile } from "./roles/role-tile";

const DOCS = "https://github.com/stephenhungg/skarl/blob/main/docs/";

// Five soft tiles, three then two, each with one thing the role can do and one it cannot.
export function Roles() {
  const rowA = ROLES.slice(0, 3);
  const rowB = ROLES.slice(3);
  return (
    <section id="roles" aria-labelledby="roles-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
      <style>{ROLE_TILE_CSS}</style>
      <Reveal>
        <SectionHeader id="roles-title" eyebrow="Roles" title="Who can do what" href={`${DOCS}security.md`} external />
      </Reveal>
      <div className="mt-8 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {rowA.map((r, i) => (
            <Reveal key={r.role} index={i} className="h-full">
              <RoleTile role={r} />
            </Reveal>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rowB.map((r, i) => (
            <Reveal key={r.role} index={i + 3} className="h-full">
              <RoleTile role={r} />
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal className="mt-8">
        <div className="flex flex-col gap-3 px-0 md:px-6">
          <span className="flex items-center gap-2">
            <StatusPill status="SIMULATED" />
            <span className="mono text-[12px] leading-none text-slate-500">Tested invariants</span>
          </span>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-1.5 p-0 text-[12px] leading-[1.35] text-slate-500 md:grid-cols-2">
            {ROLE_INVARIANTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="m-0 text-[12px] leading-[1.35] text-slate-500">
            These hold in the ledger and Convex test suites, which run on fixtures. Demo identities can be impersonated, so the role checks are demo policy, not production sign-in.
          </p>
        </div>
      </Reveal>
      </div>
    </section>
  );
}
