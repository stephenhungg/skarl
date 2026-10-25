"use client";
import { Component, type ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/glaze/ui/empty-state";
import { Skeleton } from "@/components/glaze/ui/skeleton";
import { useConvexConfig } from "@/components/convex-provider";
import { cn } from "@/lib/glaze/utils";
import { formatUsdc, humanize } from "./format";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="type-title">{title}</h1>
        {description && <p className="mt-1 type-body-sm text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, meta, children, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="type-heading-sm">{title}</h2>
        {meta && <span className="type-label-sm text-text-3">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/** USDC with the unit muted and smaller than the number. */
export function Amount({ value, className, unit = true }: { value: string | bigint | null | undefined; className?: string; unit?: boolean }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatUsdc(value)}{unit && <span className="ms-1 text-[0.72em] text-text-3">USDC</span>}
    </span>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
}

export function Unavailable({ title, description }: { title: string; description: ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Live screens need a configured Convex client; without one they say so instead of rendering fake data. */
export function RequireConvex({ children }: { children: ReactNode }) {
  const config = useConvexConfig();
  if (config.status === "ready") return <QueryBoundary>{children}</QueryBoundary>;
  return <Unavailable title="Not connected to Convex"
    description={config.status === "missing" ? "Set NEXT_PUBLIC_CONVEX_URL in apps/web/.env.local and restart the dev server." : `Convex URL is invalid: ${config.reason}`} />;
}

/** Query errors throw. Show the code the backend returned, recoverably, never a fabricated zero. */
export class QueryBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const code = this.state.error.message.match(/([a-z][a-z0-9_]+)\s*$/)?.[1] ?? "query_failed";
    return (
      <div className="flex flex-col items-start gap-3">
        <Unavailable title="This view could not load" description={`${humanize(code)}. The data was not shown rather than guessed.`} />
        <button type="button" className="type-label text-text-2 underline underline-offset-4" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
