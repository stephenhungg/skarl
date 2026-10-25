import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/convex-provider";

// Convex is scoped to this route on purpose; the root layout stays backend-free.
export default function ContributeLayout({ children }: { children: ReactNode }) {
  return <ConvexClientProvider>{children}</ConvexClientProvider>;
}
