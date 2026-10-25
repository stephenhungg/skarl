import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "@/components/glaze/styles.css";
import { ConvexClientProvider } from "@/components/convex-provider";

const sans = Geist({ subsets: ["latin"], variable: "--font-dashboard-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-dashboard-mono", display: "swap" });

// Convex is scoped to this route on purpose; the root layout stays backend-free.
export default function ContributeLayout({ children }: { children: ReactNode }) {
  return <div className={`${sans.variable} ${mono.variable}`}><ConvexClientProvider>{children}</ConvexClientProvider></div>;
}
