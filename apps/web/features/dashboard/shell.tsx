"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GlazePortalProvider } from "@/lib/glaze/portal";
import { cn } from "@/lib/glaze/utils";
import { BreadcrumbTrail } from "@/components/glaze/ui/breadcrumb";
import { Kbd } from "@/components/glaze/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/glaze/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuTrigger } from "@/components/glaze/ui/dropdown-menu";
import { Toaster } from "@/components/glaze/ui/toast";
import { ChevronSort, Icon } from "@/components/glaze/icon";
import { LogoMark } from "@/components/logo-mark";
import { useConvexConfig } from "@/components/convex-provider";
import { Lordicon, type LordiconName } from "./lordicon";
import { AccountMenu } from "@/features/auth/account-menu";
import { needsYou, useOrderData, useOrderId } from "./data";
import { OrderSwitcher } from "./order-switcher";

export type NavItem = { href: string; label: string; icon: LordiconName; count?: string; loud?: boolean };
export type ShellConfig = {
  /** The role's home route; also the breadcrumb root. */
  home: string;
  role: string;
  homeLabel: string;
  nav: { group?: string; items: NavItem[] }[];
  mobile: NavItem[];
  titles: Record<string, string>;
  switchTo: { label: string; href: string };
};
export type Counts = Record<string, number>;

const CONTROLLER_NAV: ShellConfig["nav"] = [
  { items: [
    { href: "/dashboard", label: "Overview", icon: "bar-chart-vertical-grow" },
    { href: "/dashboard/inbox", label: "Exceptions", icon: "lifebuoy", count: "needs", loud: true },
  ] },
  { group: "Work", items: [
    { href: "/dashboard/submissions", label: "Submissions", icon: "file-pencil", count: "review" },
    { href: "/dashboard/payables", label: "Payables", icon: "coins", count: "approve" },
    { href: "/dashboard/reconciliation", label: "Reconciliation", icon: "check" },
    { href: "/dashboard/ledger", label: "Ledger", icon: "layers" },
  ] },
  { group: "System", items: [
    { href: "/dashboard/agent", label: "Finance agent", icon: "browser-terminal" },
    { href: "/dashboard/audit", label: "Audit log", icon: "fingerprint-circle" },
    { href: "/dashboard/scenarios", label: "Scenario lab", icon: "wrench" },
    { href: "/dashboard/integrations", label: "Integrations", icon: "globe" },
  ] },
];
export const CONTROLLER_SHELL: ShellConfig = {
  home: "/dashboard", role: "Buyer", homeLabel: "Overview", nav: CONTROLLER_NAV,
  mobile: [CONTROLLER_NAV[0]!.items[0]!, CONTROLLER_NAV[0]!.items[1]!, CONTROLLER_NAV[1]!.items[0]!, CONTROLLER_NAV[1]!.items[1]!],
  titles: { receipt: "Receipt", inbox: "Exceptions", submissions: "Submissions", payables: "Payables", ledger: "Ledger", agent: "Finance agent", audit: "Audit log", scenarios: "Scenario lab", reconciliation: "Reconciliation", integrations: "Integrations" },
  switchTo: { label: "Open contributor view", href: "/contribute" },
};
const STORE = "skarl:dashboard:sidebar";

const isActive = (pathname: string, href: string, home: string) => href === home ? pathname === href : pathname.startsWith(href);

// Counts read live data, so they mount only under a configured Convex client.
function ControllerCounts({ children }: { children: (counts: Counts) => ReactNode }) {
  const orderId = useOrderId();
  const { submissions, payables } = useOrderData(orderId);
  const n = needsYou(submissions, payables);
  return children({ needs: n.total, review: n.review.length, approve: n.approve.length + n.sign.length });
}

function Count({ loud, value, collapsed }: { loud?: boolean; value: number; collapsed: boolean }) {
  if (value === 0) return null;
  // Only work that waits on this person is loud: a count anywhere else is muted text.
  if (collapsed) return <span className="absolute end-1 top-1 min-w-3.5 rounded-pill bg-ink px-1 text-center type-label-sm leading-3.5 text-text-inverse tabular-nums">{value}</span>;
  return loud
    ? <span className="ms-auto min-w-5 rounded-pill bg-ink px-1.5 text-center type-label-sm leading-5 text-text-inverse tabular-nums">{value}</span>
    : <span className="ms-auto type-label-sm text-text-3 tabular-nums">{value}</span>;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { status } = useConvexConfig();
  return status === "ready"
    ? <ControllerCounts>{counts => <AppShell config={CONTROLLER_SHELL} counts={counts} header={<OrderSwitcher />}>{children}</AppShell>}</ControllerCounts>
    : <AppShell config={CONTROLLER_SHELL} counts={{}}>{children}</AppShell>;
}

/** The shared app frame: sidebar, breadcrumbs, mobile bar and toaster, for any role. */
export function AppShell({ config, counts, header, children }: { config: ShellConfig; counts: Counts; header?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { try { setCollapsed(localStorage.getItem(STORE) === "1"); } catch { /* storage unavailable */ } }, []);
  const toggle = useCallback(() => setCollapsed(value => {
    try { localStorage.setItem(STORE, value ? "0" : "1"); } catch { /* storage unavailable */ }
    return !value;
  }), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "[" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b")) { event.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const segments = pathname.split("/").filter(Boolean).slice(1);
  const crumbs = [{ label: config.role, href: config.home },
    ...(segments.length === 0 ? [{ label: config.homeLabel }] : segments.map((segment, index) => ({
      label: config.titles[segment] ?? segment, id: !config.titles[segment],
      href: index < segments.length - 1 ? `${config.home}/${segments.slice(0, index + 1).join("/")}` : undefined,
    })))];

  return (
    <div className="glaze skarl-theme min-h-dvh bg-page font-sans text-text-1">
      <GlazePortalProvider>
        <TooltipProvider>
          <div className={cn("grid min-h-dvh md:grid-cols-[var(--sidebar)_1fr]")} style={{ ["--sidebar" as string]: collapsed ? "52px" : "240px" }}>
            <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line-faint bg-page md:flex" aria-label="Dashboard">
              <div className={cn("flex h-14 items-center px-2", collapsed && "justify-center px-0")}>
                <DropdownMenu>
                  <DropdownMenuTrigger className={cn("flex w-full min-w-0 items-center gap-2 rounded-tag p-1.5 text-start hover:bg-hover", collapsed && "w-auto")}
                    aria-label="Workspace and identity">
                    <span className="grid size-7 shrink-0 place-items-center rounded-tag bg-ink text-text-inverse"><LogoMark size={8} /></span>
                    {!collapsed && <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-label">Skarl</span>
                        <span className="block truncate type-label-sm text-text-3">{config.role}</span>
                      </span>
                      <Icon icon={ChevronSort} size={14} className="text-text-3" />
                    </>}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLinkItem render={<Link href={config.switchTo.href} />}>{config.switchTo.label}</DropdownMenuLinkItem>
                    <DropdownMenuLinkItem render={<Link href="/" />}>Back to the landing page</DropdownMenuLinkItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pt-2">
                {config.nav.map((section, index) => (
                  <div key={section.group ?? index} className="flex flex-col gap-px">
                    {section.group && !collapsed && <p className="px-2 pb-1 type-label-sm text-text-3">{section.group}</p>}
                    {section.items.map(item => {
                      const active = isActive(pathname, item.href, config.home);
                      const value = item.count ? counts[item.count] ?? 0 : 0;
                      const link = (
                        <Link href={item.href} aria-current={active ? "page" : undefined}
                          className={cn("relative flex h-8 items-center gap-2 rounded-tag px-2 type-label transition-colors duration-(--dur-state)",
                            active ? "bg-pressed text-text-1" : "text-text-2 hover:bg-hover hover:text-text-1", collapsed && "justify-center px-0")}>
                          <Lordicon name={item.icon} size={16} />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                          <Count loud={item.loud} value={value} collapsed={collapsed} />
                        </Link>
                      );
                      return collapsed
                        ? <Tooltip key={item.href}><TooltipTrigger render={link} /><TooltipContent side="right">{item.label}</TooltipContent></Tooltip>
                        : <div key={item.href}>{link}</div>;
                    })}
                  </div>
                ))}
              </nav>
              <div className="flex flex-col gap-1 border-t border-line-faint p-2">
                <div className={cn("flex h-8 items-center gap-2 rounded-tag px-2 type-label-sm text-text-2", collapsed && "justify-center px-0")} title="Base Sepolia testnet. Test USDC only.">
                  <Lordicon name="globe" size={16} />
                  {!collapsed && <span>Base Sepolia &middot; testnet</span>}
                </div>
                <button type="button" onClick={toggle} className={cn("flex h-8 items-center gap-2 rounded-tag px-2 type-label-sm text-text-2 hover:bg-hover", collapsed && "justify-center px-0")}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
                  {collapsed ? <Kbd keys="[" /> : <><span>Collapse</span><Kbd keys="[" className="ms-auto" /></>}
                </button>
              </div>
            </aside>
            <div className="flex min-w-0 flex-col pb-16 md:pb-0">
              <header className="sticky top-0 z-(--z-sticky) flex h-12 items-center gap-3 border-b border-line-faint bg-page px-4 md:px-6">
                <BreadcrumbTrail items={crumbs} renderLink={href => <Link href={href} />} className="min-w-0 flex-1" />
                {header}
                <AccountMenu />
              </header>
              <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
            </div>
          </div>
          {/* Glaze ships its own utility sheet, so the breakpoint lives on a wrapper with no competing display class. */}
          <div className="md:hidden">
          <nav className="fixed inset-x-0 bottom-0 z-(--z-sticky) grid border-t border-line-faint bg-page" aria-label="Dashboard" style={{ gridTemplateColumns: `repeat(${config.mobile.length}, minmax(0, 1fr))` }}>
            {config.mobile.map(item => {
              const active = isActive(pathname, item.href, config.home);
              const value = item.count ? counts[item.count] ?? 0 : 0;
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-14 flex-col items-center justify-center gap-1 type-label-sm", active ? "text-text-1" : "text-text-3")}>
                  <Lordicon name={item.icon} size={18} />
                  <span>{item.label}</span>
                  {value > 0 && <span className="absolute top-1.5 start-[calc(50%+6px)] min-w-4 rounded-pill bg-ink px-1 text-center type-label-sm leading-4 text-text-inverse tabular-nums">{value}</span>}
                </Link>
              );
            })}
          </nav>
          </div>
          <Toaster />
        </TooltipProvider>
      </GlazePortalProvider>
    </div>
  );
}
