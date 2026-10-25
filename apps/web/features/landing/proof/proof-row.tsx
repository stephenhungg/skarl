import { StatusPill } from "@/components/status-pill";
import type { ProofRow as Row } from "../evidence";

// Dated row: 72px mono date column, title, one-line summary, status pill on the right.
// Hover: radial wash rises from the bottom edge and the text block shifts 8px.
export function ProofRow({ row }: { row: Row }) {
  const body = (
    <span className="pl-row relative flex w-full items-start gap-4 px-[18px] py-6 md:gap-8 md:px-6 md:py-8">
      <span className="mono w-[44px] flex-none pt-[3px] text-[12px] leading-none text-slate-500 md:w-[72px]">{row.date}</span>
      <span className="pl-text flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="cut-regular text-[16px] leading-[1.2] tracking-[0.01em] text-ink md:text-[18px]">{row.title}</span>
        <span className="line-clamp-2 text-[13px] leading-[1.25] tracking-[0.01em] text-slate-500 md:line-clamp-1 md:text-[16px]">{row.summary}</span>
      </span>
      <StatusPill status={row.status} className="flex-none" />
      <svg className="pl-hair pointer-events-none absolute inset-x-0 bottom-0 h-px w-full" preserveAspectRatio="none" viewBox="0 0 100 1" aria-hidden="true">
        <path d="M0 .5h100" stroke="rgb(var(--haze))" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
  return (
    <li className="pl-item">
      {row.href ? (
        <a href={row.href} target="_blank" rel="noopener noreferrer" className="pl-link block">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

export const PROOF_CSS = `
.pl-row::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(50% 314% at 50% 100%,rgb(var(--mist)) 0%,transparent 100%);opacity:0;transition:opacity .45s cubic-bezier(.06,.63,.39,.93)}
.pl-row>*:not(.pl-hair){position:relative}
.pl-text{transition:transform .45s cubic-bezier(.06,.63,.39,.93)}
.pl-link:hover .pl-row::before,.pl-link:focus-visible .pl-row::before{opacity:1}
.pl-link:hover .pl-text,.pl-link:focus-visible .pl-text{transform:translateX(8px)}
.pl-open{transition:padding .5s var(--ease-hover)}
.pl-open svg{transition:left .5s var(--ease-hover),right .5s var(--ease-hover),opacity .5s var(--ease-hover),filter .5s var(--ease-hover)}
.pl-open .pl-open-a{right:8px;opacity:1;filter:blur(0)}
.pl-open .pl-open-b{left:-29px;opacity:0;filter:blur(8px)}
.pl-open:hover,.pl-open:focus-visible{padding-left:38px;padding-right:8px}
.pl-open:hover .pl-open-a,.pl-open:focus-visible .pl-open-a{right:-28px;opacity:0;filter:blur(8px)}
.pl-open:hover .pl-open-b,.pl-open:focus-visible .pl-open-b{left:8px;opacity:1;filter:blur(0)}
`;
