"use client";
import { useEffect, type CSSProperties } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "lord-icon": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string; trigger?: string; target?: string; stroke?: string; state?: string; loading?: string; "current-color"?: string;
      };
    }
  }
}

export type LordiconName =
  | "bar-chart-vertical-grow" | "badge-ribbon" | "file-pencil" | "coins" | "layers" | "browser-terminal"
  | "fingerprint-circle" | "wrench" | "globe" | "check" | "clock" | "arrow-out-square" | "desktop" | "folder";

let defined: Promise<void> | null = null;
const define = () => (defined ??= import("@lordicon/element").then(m => m.defineElement()));

/** Lordicon from /public/lordicon. Plays once on hover of the nearest link or button. */
export function Lordicon({ name, size = 16, trigger = "hover", target = "a, button", style }: {
  name: LordiconName; size?: number; trigger?: "hover" | "in" | "loop"; target?: string; style?: CSSProperties;
}) {
  useEffect(() => { define(); }, []);
  return <lord-icon aria-hidden="true" src={`/lordicon/${name}.json`} trigger={trigger} target={target} stroke="regular"
    loading="lazy" current-color="" style={{ display: "block", flex: "none", width: size, height: size, color: "currentColor", ...style }} />;
}
