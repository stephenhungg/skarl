import type { Metadata } from "next";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/convex-provider";
import localFont from "next/font/local";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";

const montrealBook = localFont({ src: "./fonts/montreal-book.woff2", weight: "400", variable: "--font-montreal-book", display: "swap" });
const montrealRegular = localFont({ src: "./fonts/montreal-regular.woff2", weight: "400", variable: "--font-montreal-regular", display: "swap" });
const montrealMedium = localFont({ src: "./fonts/montreal-medium.woff2", weight: "500", variable: "--font-montreal-medium", display: "swap" });
const fono = localFont({ src: "./fonts/fono.woff2", weight: "400", variable: "--font-fono", display: "swap" });

export const metadata: Metadata = {
  title: "Skarl",
  description: "Verified human demonstrations, paid in USDC on Base Sepolia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const fonts = [montrealBook, montrealRegular, montrealMedium, fono].map(f => f.variable).join(" ");
  const content = (
    <html lang="en" className={fonts}>
      <body>
        <SmoothScroll />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
  // Preserve the existing honest unavailable state when no backend is configured.
  return process.env.NEXT_PUBLIC_CONVEX_URL?.trim()
    ? <ConvexAuthNextjsServerProvider>{content}</ConvexAuthNextjsServerProvider>
    : content;
}
