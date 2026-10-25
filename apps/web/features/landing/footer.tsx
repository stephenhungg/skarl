import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { DEMO_VIDEO_URL } from "./evidence";
import { FooterTicks } from "./footer/ticks";

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
      <path d="M0 .5h100" stroke="rgb(var(--haze))" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Footer() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const legal = ["Built at Cal Hacks 13.0", sha ? `commit ${sha}` : null, "Base Sepolia", "test tokens only"].filter(Boolean).join(" · ");

  return (
    <footer className="relative overflow-clip bg-mist">
      <FooterTicks />
      <div className="relative pb-[150px] pt-[72px]">
      <div className="frame">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between md:gap-8">
          <div className="flex max-w-[360px] flex-col gap-4">
            <Wordmark size={24} />
            <p className="m-0 text-[14px] leading-[1.3] tracking-[0.01em] text-slate-500">
              Narrated human demonstrations, checked against the video and paid in test USDC after a person approves.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:w-[540px] md:flex-none">
            {COLUMNS.map((col) => {
              const id = `footer-${col.title.toLowerCase()}`;
              return (
                <nav key={col.title} aria-labelledby={id} className="flex flex-col">
                  <Hairline />
                  <p id={id} className="cut-regular m-0 pb-4 pt-2 text-[14px] leading-[1.2] text-deep">{col.title}</p>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {col.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="text-[14px] leading-[1.2] text-slate-500 transition-colors duration-[400ms] ease-[var(--ease-hover)] hover:text-deep"
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
        <div className="mt-16">
          <Hairline />
          <p className="m-0 pt-4 text-[10px] leading-[1.2] text-slate-500 md:text-[12px]">{legal}</p>
        </div>
      </div>
      </div>
    </footer>
  );
}
