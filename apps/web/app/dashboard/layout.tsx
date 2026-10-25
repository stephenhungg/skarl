import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "@/components/glaze/styles.css";
import { ConvexClientProvider } from "@/components/convex-provider";
import { DashboardShell } from "@/features/dashboard/shell";

// Glaze names Geist as its sans fallback; loading it here keeps the dashboard off the landing page's fonts.
const sans = Geist({ subsets: ["latin"], variable: "--font-dashboard-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-dashboard-mono", display: "swap" });

export const metadata: Metadata = { title: "Controller · Skarl", description: "Review evidence, approve payouts and reconcile the books." };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <ConvexClientProvider>
        <DashboardShell>{children}</DashboardShell>
      </ConvexClientProvider>
    </div>
  );
}
