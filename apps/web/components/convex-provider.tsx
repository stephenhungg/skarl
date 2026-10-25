"use client";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { createContext, useContext, useState, type ReactNode } from "react";

// Next inlines NEXT_PUBLIC_* at build time, so this must be a direct property read.
const RAW_URL = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() || "";

export type ConvexConfig =
  | { status: "ready"; url: string }
  | { status: "missing" }
  | { status: "invalid"; url: string; reason: string };

const ConvexConfigContext = createContext<ConvexConfig>({ status: "missing" });

/** Which Convex deployment (if any) this subtree talks to. Components must not call Convex hooks unless status is "ready". */
export function useConvexConfig() {
  return useContext(ConvexConfigContext);
}

function createClient(): { client: ConvexReactClient | null; config: ConvexConfig } {
  if (!RAW_URL) return { client: null, config: { status: "missing" } };
  try {
    const client = new ConvexReactClient(RAW_URL);
    return { client, config: { status: "ready", url: RAW_URL } };
  } catch (error) {
    return { client: null, config: { status: "invalid", url: RAW_URL, reason: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * One authenticated Convex client for the app. Without NEXT_PUBLIC_CONVEX_URL it renders children
 * with no client, so pages can show an honest unavailable state instead of crashing or pretending.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [{ client, config }] = useState(createClient);
  if (!client) return <ConvexConfigContext.Provider value={config}>{children}</ConvexConfigContext.Provider>;
  return (
    <ConvexAuthNextjsProvider client={client}>
      <ConvexConfigContext.Provider value={config}>{children}</ConvexConfigContext.Provider>
    </ConvexAuthNextjsProvider>
  );
}
