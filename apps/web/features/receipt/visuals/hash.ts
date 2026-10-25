/** 32-bit FNV-1a hash, used to seed the fingerprint shape from the receipt hash. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x1000193);
  }
  return h >>> 0;
}

/** Receipt palette: one hue at 24% saturation across a lightness ramp. */
export function receiptPalette(hue: number | string = "var(--receipt-hue, 100)") {
  const c = (l: number, a = 1) => `hsl(${hue} 24% ${l}% / ${a})`;
  return {
    white: c(99),
    paper: c(97),
    soft: c(94),
    surface: c(90),
    shade: c(84),
    edge: c(78),
    grid: c(70),
    line: c(62),
    outline: c(54),
    ink: c(46),
    deep: c(24),
    screen: c(12),
    glaze: c(94, 0.5),
    land: c(78, 0.3),
    boundary: c(54, 0.4),
    graticule: c(46, 0.19),
    ring: c(62, 0.33),
  };
}
