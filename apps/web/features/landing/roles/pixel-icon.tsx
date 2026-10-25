import type { RoleTile } from "../evidence";

// 7 x 7 icons on the page's 10px module. "." is empty, 1 to 3 step up the neutral ramp.
const ICONS: Record<RoleTile["icon"], string[]> = {
  hand: [
    ".2.2.2.",
    ".2.2.2.",
    ".22222.",
    "222222.",
    ".22222.",
    "..222..",
    "..333..",
  ],
  camera: [
    ".......",
    ".33....",
    "3333333",
    "3311133",
    "3312133",
    "3311133",
    "3333333",
  ],
  eye: [
    ".......",
    "..333..",
    ".31213.",
    "3123213",
    ".31213.",
    "..333..",
    ".......",
  ],
  ledger: [
    "333333.",
    "311113.",
    "322213.",
    "311113.",
    "322113.",
    "311113.",
    "333333.",
  ],
  stamp: [
    "..333..",
    "..333..",
    "...3...",
    "...3...",
    ".33333.",
    "3333333",
    "1111111",
  ],
};

const TONE: Record<string, string> = {
  "1": "rgb(var(--haze))",
  "2": "rgb(var(--slate-300))",
  "3": "rgb(var(--slate-700))",
};

const MODULE = 10;

export function PixelIcon({ name, className }: { name: RoleTile["icon"]; className?: string }) {
  const rows = ICONS[name];
  const size = rows.length * MODULE;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" className={className} shapeRendering="crispEdges">
      {rows.flatMap((row, y) =>
        row.split("").map((cell, x) =>
          cell === "." ? null : <rect key={`${x}-${y}`} x={x * MODULE + 1} y={y * MODULE + 1} width={MODULE - 2} height={MODULE - 2} rx={1} fill={TONE[cell]} />,
        ),
      )}
    </svg>
  );
}
