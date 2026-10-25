import { LogoMark } from "./logo-mark";

export function Wordmark({ size = 20, color = "rgb(var(--ink))" }: { size?: number; color?: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.2, color }}>
      <LogoMark size={size * 0.85} />
      <span className="cut-medium" style={{ fontSize: size, lineHeight: 1, letterSpacing: "-0.03em" }}>skarl</span>
    </span>
  );
}
