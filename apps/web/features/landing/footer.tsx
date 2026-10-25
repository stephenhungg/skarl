import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { DEMO_VIDEO_URL } from "./evidence";
import { OrbitCanvas } from "./footer/orbit-canvas";

const REPO = "https://github.com/stephenhungg/skarl";
const DOC = `${REPO}/blob/main/docs/`;

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Contribute", href: "/contribute" },
      { label: "Console", href: "/dashboard" },
      ...(DEMO_VIDEO_URL ? [{ label: "Demo video", href: DEMO_VIDEO_URL, external: true }] : []),
    ],
  },
  {
    title: "Build",
    links: [
      { label: "GitHub", href: REPO, external: true },
      { label: "Docs", href: `${REPO}/tree/main/docs`, external: true },
      { label: "Architecture", href: `${DOC}architecture.md`, external: true },
      { label: "Setup", href: `${DOC}setup.md`, external: true },
    ],
  },
  {
    title: "Event",
    links: [
      { label: "Devpost", href: "https://cal-hacks-13-0.devpost.com/", external: true },
      { label: "Cal Hacks 13.0", href: "https://www.calhacks.io/", external: true },
    ],
  },
];

function Hairline() {
  return (
    <svg className="block h-px w-full" preserveAspectRatio="none" viewBox="0 0 100 1" aria-hidden="true">
      <path d="M0 .5h100" stroke="rgb(var(--paper) / 0.16)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Footer() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const legal = ["Built at Cal Hacks 13.0", sha ? `commit ${sha}` : null, "Base Sepolia", "test tokens only"].filter(Boolean).join(" · ");

  return (
    <footer className="relative overflow-clip bg-ink">
      {/* the night earth from orbit, its limb rising under the links */}
      <OrbitCanvas bottomRow={88} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(to bottom, rgb(var(--ink)) 0%, rgb(var(--ink) / 0.82) 34%, rgb(var(--ink) / 0) 62%)" }}
      />
      <div className="relative flex min-h-[760px] flex-col pb-8 pt-[72px] md:min-h-[600px]">
      <div className="frame flex flex-1 flex-col">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between md:gap-8">
          <div className="flex max-w-[360px] flex-col gap-4">
            <Wordmark size={24} color="rgb(var(--paper))" />
            <p className="m-0 text-[14px] leading-[1.3] tracking-[0.01em] text-fog">
              Narrated task videos from real people, reviewed by a person and paid in test USDC.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:w-[540px] md:flex-none">
            {COLUMNS.map((col) => {
              const id = `footer-${col.title.toLowerCase()}`;
              return (
                <nav key={col.title} aria-labelledby={id} className="flex flex-col">
                  <Hairline />
                  <p id={id} className="cut-regular m-0 pb-4 pt-2 text-[14px] leading-[1.2] text-paper">{col.title}</p>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {col.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="text-[14px] leading-[1.2] text-fog transition-colors duration-[400ms] ease-[var(--ease-hover)] hover:text-paper"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              );
            })}
          </div>
        </div>
        <div className="mt-auto pt-[160px] md:pt-16">
          <Hairline />
          <p className="m-0 pt-4 text-[10px] leading-[1.2] text-slate-300 md:text-[12px]">{legal}</p>
        </div>
      </div>
      </div>
    </footer>
  );
}
