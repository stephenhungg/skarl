import type { ReactNode } from "react";
import "@/components/glaze/styles.css";
import "@/features/dashboard/skarl-theme.css";
import { skarlMono, skarlSans } from "@/features/dashboard/fonts";
import { ConvexClientProvider } from "@/components/convex-provider";


// Convex is scoped to this route on purpose; the root layout stays backend-free.
export default function ContributeLayout({ children }: { children: ReactNode }) {
  return <div className={`${skarlSans.variable} ${skarlMono.variable}`}><ConvexClientProvider>{children}</ConvexClientProvider></div>;
}
