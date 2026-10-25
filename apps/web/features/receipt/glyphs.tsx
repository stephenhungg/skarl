/* Small inline glyphs used across the receipt page. */

const tone = (l: number, a = 1) => `hsl(var(--receipt-hue, 100) 24% ${l}% / ${a})`;

/** Compass dial with the needle at the recorded heading. */
export function MotionDial({ heading, north }: { heading: number; north: boolean }) {
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="24" fill={tone(94, 0.5)} stroke={tone(70)} strokeWidth=".7" />
      <circle cx="32" cy="32" r="18" fill="none" stroke={tone(78)} strokeWidth=".5" strokeDasharray="1 3" />
      {ticks.map((deg) => (
        <path
          key={deg}
          d={deg % 45 === 0 ? "M32 3V8" : "M32 5V8"}
          transform={`rotate(${deg} 32 32)`}
          stroke={tone(62)}
          strokeWidth={deg % 45 === 0 ? "0.8" : "0.5"}
        />
      ))}
      <path d="M12 32h40M32 12v40" stroke={tone(78)} strokeWidth=".5" />
      <g transform={`rotate(${heading} 32 32)`}>
        <path d="m32 13 7 23-7-4-7 4Z" fill="var(--receipt-accent, #a9d97f)" stroke="var(--receipt-accent-ink, #2c3a1a)" strokeWidth=".5" />
        <path d="m32 51 7-15-7-4-7 4Z" fill={tone(84)} stroke={tone(70)} strokeWidth=".5" />
      </g>
      {north && (
        <text x="32" y="8" textAnchor="middle" fontFamily="monospace" fontSize="6" fill="var(--receipt-accent-ink, #2c3a1a)">
          N
        </text>
      )}
    </svg>
  );
}

/** Media category icons (16px grid). */
export function MediaIcon({ media }: { media: string }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.25",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "size-3.5",
  };
  return (
    <svg {...common}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
      <circle cx="5.75" cy="5.75" r="1" />
      <path d="m3 11 3-2.5 2.25 1.75L11 7l2 2" />
    </svg>
  );
}

export function ArrowUpRight({ size, strokeWidth }: { size: number; strokeWidth: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={size}
      height={size}
    >
      <path d="M5 11 11 5" />
      <path d="M5.5 5H11v5.5" />
    </svg>
  );
}
