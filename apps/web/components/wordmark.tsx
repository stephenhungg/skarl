export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="cut-medium" style={{ fontSize: size, lineHeight: 1, letterSpacing: "-0.03em", color: "rgb(var(--ink))" }}>
      skarl
    </span>
  );
}
