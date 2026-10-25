import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Skarl — build workspace", description: "Verified human demonstrations, paid in USDC on Base Sepolia. Development scaffold." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
