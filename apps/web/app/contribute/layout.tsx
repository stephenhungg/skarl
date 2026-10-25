import type { ReactNode } from "react";
import "@/components/glaze/styles.css";
import "@/features/dashboard/skarl-theme.css";
import { skarlMono, skarlSans } from "@/features/dashboard/fonts";


// Authentication and the Convex client are shared by the root layout.
export default function ContributeLayout({ children }: { children: ReactNode }) {
  return <div className={`${skarlSans.variable} ${skarlMono.variable}`}>{children}</div>;
}
