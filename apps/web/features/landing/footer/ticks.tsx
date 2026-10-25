// Low-alpha timeline ticks on the 10px module: a short tick every 10px, taller every 50, tallest every 100.
// A few longer marks stand in for evidence markers on a clip timeline. Pure SVG, no motion.
export function FooterTicks() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[120px] w-full" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <pattern id="footer-ticks" width="100" height="120" patternUnits="userSpaceOnUse">
          {Array.from({ length: 10 }, (_, i) => {
            const h = i === 0 ? 30 : i === 5 ? 18 : 10;
            return <rect key={i} x={i * 10} y={120 - h} width="1" height={h} fill="rgb(var(--slate-300))" />;
          })}
        </pattern>
        <pattern id="footer-marks" width="430" height="120" patternUnits="userSpaceOnUse">
          <rect x="70" y="56" width="1" height="64" fill="rgb(var(--slate-300))" />
          <rect x="260" y="74" width="1" height="46" fill="rgb(var(--slate-300))" />
        </pattern>
        <linearGradient id="footer-ticks-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="footer-ticks-mask">
          <rect width="100%" height="100%" fill="url(#footer-ticks-fade)" />
        </mask>
      </defs>
      <g mask="url(#footer-ticks-mask)" opacity="0.35">
        <rect width="100%" height="100%" fill="url(#footer-ticks)" />
        <rect width="100%" height="100%" fill="url(#footer-marks)" />
      </g>
    </svg>
  );
}
