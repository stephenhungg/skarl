import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";

/** Montreal as one family with real 400 and 500 cuts, so Glaze's medium labels use the medium file, not faux bold. */
export const skarlSans = localFont({
  src: [
    { path: "../../app/fonts/montreal-book.woff2", weight: "400", style: "normal" },
    { path: "../../app/fonts/montreal-medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-skarl-sans",
  display: "swap",
});

/** Only for values a person copies: hashes, IDs, code. */
export const skarlMono = Geist_Mono({ subsets: ["latin"], variable: "--font-dashboard-mono", display: "swap" });
