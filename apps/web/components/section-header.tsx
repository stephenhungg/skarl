import Link from "next/link";
import { ArrowGlyph } from "./arrow";

type Props = {
  eyebrow: string;
  title: string;
  /** When set, the title becomes a link with the M4 arrow blur-swap. */
  href?: string;
  external?: boolean;
  /** Applied to the title, so a section can use aria-labelledby={id}. */
  id?: string;
};

// 32x3 dash, eyebrow, title. Left aligned on desktop and tablet, centered under 810.
// M4: on hover the trailing arrow blurs out to the right, a leading arrow blurs in from the left
// and the title shifts 34px, 0.5s on the hover curve.
export function SectionHeader({ eyebrow, title, href, external, id }: Props) {
  const titleEl = (
    <h2 id={id} className="cut-regular m-0 text-[20px] leading-[1.2] text-deep md:text-[24px]">
      {title}
    </h2>
  );
  const ext = external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <div className="flex w-full flex-col items-center gap-1.5 text-center min-[810px]:items-start min-[810px]:text-left">
      <svg className="block h-[3px] w-8 flex-none" viewBox="0 0 32 3" aria-hidden="true">
        <path d="M1 1.5h30" stroke="rgb(var(--slate-300))" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col items-center min-[810px]:items-start">
        <p className="cut-book m-0 text-[14px] leading-[1.2] tracking-[0.01em] text-slate-300">{eyebrow}</p>
        {href ? (
          <Link
            href={href}
            {...ext}
            className="group relative flex w-max items-center py-[5px] pr-[38px] transition-[padding] duration-500 ease-[var(--ease-hover)] hover:pl-[34px] hover:pr-1 focus-visible:pl-[34px] focus-visible:pr-1"
          >
            {titleEl}
            <ArrowGlyph className="absolute right-[3px] top-1/2 -translate-y-1/2 text-deep opacity-100 blur-[0px] transition-[right,opacity,filter] duration-500 ease-[var(--ease-hover)] group-hover:-right-7 group-hover:opacity-0 group-hover:blur-[8px] group-focus-visible:-right-7 group-focus-visible:opacity-0" />
            <ArrowGlyph className="absolute -left-6 top-1/2 -translate-y-1/2 text-deep opacity-0 blur-[8px] transition-[left,opacity,filter] duration-500 ease-[var(--ease-hover)] group-hover:left-0 group-hover:opacity-100 group-hover:blur-[0px] group-focus-visible:left-0 group-focus-visible:opacity-100 group-focus-visible:blur-[0px]" />
          </Link>
        ) : (
          <div className="py-[5px]">{titleEl}</div>
        )}
      </div>
    </div>
  );
}
