import { ArrowGlyph } from "@/components/arrow";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import type { RoleTile as Role } from "../evidence";
import { PixelIcon } from "./pixel-icon";

// Soft tile with the hover arrow sliding in from the top right. Links to the doc that defines the role.
export function RoleTile({ role }: { role: Role }) {
  return (
    <a href={role.href} target="_blank" rel="noopener noreferrer" className="rt-link block h-full rounded-[12px]">
      <SpotlightCard className="flex h-full min-h-[180px] flex-col p-6">
        <span className="rt-arrow absolute right-6 top-3 text-slate-500" aria-hidden="true">
          <ArrowGlyph />
        </span>
        <PixelIcon name={role.icon} className="rt-icon block" />
        <span className="mt-auto flex flex-col gap-2 pt-6">
          <span className="cut-regular text-[18px] leading-[1.2] tracking-[0.01em] text-ink">{role.role}</span>
          <span className="flex flex-col gap-1.5 text-[14px] leading-[1.25] tracking-[0.01em]">
            <span className="flex gap-2">
              <span className="mono w-[52px] flex-none pt-[2px] text-[12px] leading-none text-slate-500">CAN</span>
              <span className="text-slate-700">{role.can}</span>
            </span>
            <span className="flex gap-2">
              <span className="mono w-[52px] flex-none pt-[2px] text-[12px] leading-none text-slate-500">CANNOT</span>
              <span className="text-slate-500">{role.cannot}</span>
            </span>
          </span>
        </span>
      </SpotlightCard>
    </a>
  );
}

export const ROLE_TILE_CSS = `
.rt-arrow{opacity:0;filter:blur(8px);transition:opacity .4s var(--ease-hover),filter .4s var(--ease-hover),right .4s var(--ease-hover)}
.rt-icon{opacity:.8;transition:opacity .4s var(--ease-hover)}
.rt-link:hover .rt-arrow,.rt-link:focus-visible .rt-arrow{opacity:1;filter:blur(0);right:14px}
.rt-link:hover .rt-icon{opacity:1}
`;
