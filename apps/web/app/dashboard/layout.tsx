import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/components/glaze/styles.css";
import "@/features/dashboard/skarl-theme.css";
import { skarlMono, skarlSans } from "@/features/dashboard/fonts";
import { DashboardAccess } from "@/features/auth/dashboard-access";
import { DashboardShell } from "@/features/dashboard/shell";

export const metadata: Metadata = { title: "Controller · Skarl", description: "Review evidence, approve payouts and reconcile the books." };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${skarlSans.variable} ${skarlMono.variable}`}>
      <DashboardAccess>
        <DashboardShell>{children}</DashboardShell>
      </DashboardAccess>
    </div>
  );
}
