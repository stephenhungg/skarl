// Ported from iso-glow (Lumen kit + iso-figure kernel), MIT License, Copyright (c) 2026 April Zhu and Tolga Cohce. See ./LICENSE.

export type V3 = [number, number, number];
export type V2 = [number, number];

/* ---------- kernel ---------- */

const C = Math.cos(Math.PI / 6);
const S = Math.sin(Math.PI / 6);

export function kernel(OX: number, OY: number) {
  const P = (x: number, y: number, z: number): V2 => [(x - y) * C + OX, (x + y) * S - z + OY];
  const D = (x: number, y: number, z: number): V2 => [(x - y) * C, (x + y) * S - z];
  const plane = (O: V3, U: V3, V: V3) => {
    const o = P(...O), u = D(...U), v = D(...V);
    return `matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${o[0]} ${o[1]})`;
  };
  const TOP = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
  const FRONT = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 0, -1]);
  const SIDE = (x: number, y: number, z: number) => plane([x, y, z], [0, -1, 0], [0, 0, -1]);
  const path = (pts: V3[]) => "M" + pts.map((p) => P(...p).map((n) => n.toFixed(2)).join(" ")).join("L");
  return { C, S, P, D, plane, TOP, FRONT, SIDE, path };
}

export type Kernel = ReturnType<typeof kernel>;
export type Frame = Kernel & { viewBox: string; W: number; H: number };

/** Frame a scene from its extreme 3D corners. Returns kernel + a viewBox padded to `aspect`. */
export function frame(points: V3[], margin = 0.09, aspect = 4 / 3): Frame {
  const d = points.map(([x, y, z]) => [(x - y) * C, (x + y) * S - z]);
  const x0 = Math.min(...d.map((p) => p[0])), x1 = Math.max(...d.map((p) => p[0]));
  const y0 = Math.min(...d.map((p) => p[1])), y1 = Math.max(...d.map((p) => p[1]));
  const m = margin * Math.max(x1 - x0, y1 - y0);
  let w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
  let ox = m - x0, oy = m - y0;
  if (w / h < aspect) { const nw = h * aspect; ox += (nw - w) / 2; w = nw; }
  else { const nh = w / aspect; oy += (nh - h) / 2; h = nh; }
  return { ...kernel(ox, oy), viewBox: `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`, W: w, H: h };
}

export const slits = (a0: number, a1: number, step: number, b0: number, b1: number, vertical = true, cls = "rw-etch") => {
  let s = "";
  for (let a = a0; a <= a1 + 1e-6; a += step)
    s += vertical
      ? `<line class="${cls}" x1="${a}" y1="${b0}" x2="${a}" y2="${b1}"/>`
      : `<line class="${cls}" x1="${b0}" y1="${a}" x2="${b1}" y2="${a}"/>`;
  return s;
};

export const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- Lumen shading layer ---------- */

// Faces mix the accent into --rw-base (the dark panel colour), so objects read as solid and lit.
const BASE = "var(--rw-base)";
const B = "var(--accent2, var(--accent))";
export const mix = (p: number, b = BASE) => `color-mix(in srgb, var(--accent) ${p}%, ${b})`;
export const mix2 = (p: number, b = BASE) => `color-mix(in srgb, ${B} ${p}%, ${b})`;
export const mixT = (p: number, b = BASE) => `color-mix(in srgb, var(--rw-tint, var(--accent)) ${p}%, ${b})`;

const st = (o: number, c: string, a = 1) => `<stop offset="${o}" style="stop-color:${c};stop-opacity:${a}"/>`;
const lg = (id: string, x2: number, y2: number, s: string) => `<linearGradient id="rw-${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
const rg = (id: string, s: string, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="rw-${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`;

/** Shared gradients and filters. Rendered once per page in a hidden svg that carries the tokens. */
export const DEFS = `
  ${lg("top", 1, 1, st(0, mixT(42)) + st(1, mix2(18)))}
  ${lg("corner", 0, 1, st(0, "var(--accent-hi)", 0.9) + st(0.45, "var(--accent)", 0.3) + st(1, B, 0))}
  ${lg("front", 0, 1, st(0, mixT(20)) + st(1, mixT(8)))}
  ${lg("side", 0, 1, st(0, mixT(10)) + st(1, mixT(2)))}
  ${lg("cyl", 1, 0, st(0, mixT(8)) + st(0.38, mixT(30)) + st(0.72, mix2(14)) + st(1, mixT(5)))}
  ${lg("litcyl", 1, 0, st(0, mix(55)) + st(0.4, "var(--accent-hi)") + st(0.75, B) + st(1, mix2(45)))}
  ${lg("lit", 0, 1, st(0, "var(--accent-hi)") + st(0.5, "var(--accent)") + st(1, mix2(70)))}
  ${lg("glass", 0, 1, st(0, "var(--accent)", 0.7) + st(1, B, 0.22))}
  ${lg("column", 0, 1, st(0, B, 0) + st(0.35, B, 0.16) + st(1, "var(--accent)", 0.34))}
  ${lg("tube", 1, 0, st(0, "var(--accent-hi)", 0.4) + st(0.14, "var(--accent)", 0.14) + st(0.5, "var(--accent)", 0.06) + st(0.86, B, 0.14) + st(1, "var(--accent-hi)", 0.35))}
  ${lg("lface", 0, 1, st(0, B, 0) + st(0.32, B, 0.2) + st(1, "var(--accent)", 0.3))}
  ${lg("ledge", 0, 1, st(0, "var(--accent-hi)", 0) + st(0.5, "var(--accent-hi)", 0.25) + st(1, "var(--accent-hi)", 0.85))}
  ${lg("cone", 0, 1, st(0, B, 0) + st(0.3, B, 0) + st(0.6, B, 0.12) + st(0.85, "var(--accent)", 0.3) + st(1, "var(--accent)", 0.45))}
  ${lg("beam", 0, 1, st(0, B, 0) + st(1, "var(--accent)", 0.55))}
  ${lg("cardf", 1, 1, st(0, mixT(52)) + st(1, mix2(28)))}
  ${lg("litwall", 0, 1, st(0, mix2(70)) + st(1, "var(--accent-hi)"))}
  ${lg("paper", 0, 1, st(0, mixT(30)) + st(1, mix2(16)))}
  <linearGradient id="rw-theme" x1="0" y1=".5" x2="1" y2=".5"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:${B}"/></linearGradient>
  <linearGradient id="rw-themehi" x1="0" y1=".5" x2="1" y2=".5"><stop offset="0" style="stop-color:var(--accent-hi)"/><stop offset="1" style="stop-color:color-mix(in srgb, ${B} 60%, #ffffff)"/></linearGradient>
  ${rg("well", st(0, "var(--accent-hi)") + st(0.55, "var(--accent)") + st(1, mix2(60)))}
  ${rg("orb", st(0, "var(--accent-hi)") + st(0.55, "var(--accent)") + st(1, mix2(55)), 0.36, 0.3, 0.8)}
  ${rg("pool", st(0, "var(--accent)", 0.22) + st(1, B, 0))}
  ${rg("shadow", st(0, "#000", 0.7) + st(1, "#000", 0))}
  <filter id="iso-glow" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="iso-soft" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="iso-bloom" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="9"/></filter>
`;

/** Tokens and shared classes, scoped to `.iso-scope` / `.iso-stage`. Lumen is dark-only. */
export const CSS = `
  .iso-scope {
    --accent:#c7f18e; --accent2:#8ff0c4; --rw-tint:#c7f18e;
    --accent-hi:color-mix(in srgb, #c7f18e 55%, #ffffff);
    --accent-dim:color-mix(in srgb, #c7f18e 16%, transparent);
    --rw-base:#10120e; --bg:#10120e;
    --mono:var(--font-fono), ui-monospace, monospace;
    color-scheme:dark;
  }
  .iso-host::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.55; transition:opacity .6s;
    background:radial-gradient(ellipse 52% 48% at 50% 56%, var(--accent-dim), transparent 74%); }
  .iso-host[data-power="on"]::before { opacity:1; }
  .iso-stage { position:relative; display:block; width:100%; height:100%; user-select:none; -webkit-user-select:none; touch-action:manipulation; }
  .iso-stage text { font-family:var(--mono); }
  .iso-stage[data-paused] * { animation-play-state:paused !important; }
  .iso-stage .rw-top { fill:url(#rw-top); }
  .iso-stage .rw-front { fill:url(#rw-front); }
  .iso-stage .rw-side { fill:url(#rw-side); }
  .iso-stage .rw-cyl { fill:url(#rw-cyl); }
  .iso-stage .rw-litcyl { fill:url(#rw-litcyl); }
  .iso-stage .rw-lit { fill:url(#rw-lit); }
  .iso-stage .rw-orb { fill:url(#rw-orb); }
  .iso-stage .rw-glass { fill:url(#rw-glass); stroke:var(--accent-hi); stroke-opacity:.75; stroke-width:1; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-paper { fill:url(#rw-paper); }
  .iso-stage .rw-flat { fill:url(#rw-theme); }
  .iso-stage .rw-hi { fill:url(#rw-themehi); }
  .iso-stage .rw-edge { fill:${mixT(42)}; }
  .iso-stage .rw-pit { fill:${mixT(5)}; }
  .iso-stage .rw-ink { fill:${mixT(14)}; }
  .iso-stage .rw-txt { fill:${mix(48)}; font-family:var(--mono); }
  .iso-stage .rw-lip { fill:none; stroke:${mix(72)}; stroke-opacity:.85; stroke-width:1.2; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-rim { fill:none; stroke:${mix(30)}; stroke-width:1; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-etch { fill:none; stroke:${mix(24)}; stroke-width:1; stroke-linecap:round; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-line { fill:none; stroke:var(--accent-hi); stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-glow { fill:url(#rw-theme); opacity:.45; }
  .iso-stage .rw-dot { fill:url(#rw-themehi); }
  .iso-stage .rw-halo { fill:url(#rw-theme); opacity:.2; }
  .iso-stage .rw-cardf { fill:url(#rw-cardf); stroke:var(--accent); stroke-width:1.2; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-litwall { fill:url(#rw-litwall); }
  .iso-stage .rw-wall { fill:${mixT(6)}; }
  .iso-stage .rw-cast { fill:#000; opacity:.38; }
  .iso-stage .rw-shadow { fill:url(#rw-shadow); }
  .iso-stage .rw-corner { fill:url(#rw-corner); }
  .iso-stage .rw-ring { fill:none; stroke:var(--accent); stroke-opacity:.22; stroke-width:1; vector-effect:non-scaling-stroke; }
  .iso-stage .rw-ring2 { fill:none; stroke:var(--accent); stroke-opacity:.16; stroke-width:1; stroke-dasharray:3 9; vector-effect:non-scaling-stroke; animation:rw-turn 40s linear infinite; }
  @keyframes rw-turn { to { stroke-dashoffset:-480; } }
  .iso-stage .rw-pool { fill:url(#rw-pool); }
  .iso-stage .rw-beam { fill:url(#rw-beam); }
  .iso-stage .rw-column { fill:url(#rw-column); }
  .iso-stage .rw-cone { fill:url(#rw-cone); }
  .iso-stage .rw-tube { fill:url(#rw-tube); }
  .iso-stage .rw-lface { fill:url(#rw-lface); }
  .iso-stage .rw-ledge { fill:url(#rw-ledge); }
  .iso-stage .rw-cedge { fill:none; stroke:var(--accent-hi); stroke-opacity:.55; stroke-width:1.2; vector-effect:non-scaling-stroke; }
  .iso-stage .press { cursor:pointer; transition:transform 60ms ease-out; }
  .iso-stage .press.down { transform:translateY(3px); }
  .iso-stage .press.lit { filter:url(#iso-glow); }
  @media (prefers-reduced-motion:reduce) { .iso-stage .rw-ring2 { animation:none; } .iso-stage .press { transition:none; } }
`;

type Shape = (cls: string, transform: string) => string;

export function kit(K: Kernel) {
  const { P } = K, f = (v: number) => v.toFixed(2), H = Math.PI / 2, q = H / 2;
  const d3 = (pts: V3[], close = true) => "M" + pts.map((p) => P(...p).map(f).join(" ")).join("L") + (close ? "Z" : "");
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 10): V2[] => {
    if (r <= 0) return [[cx, cy]];
    const o: V2[] = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  };
  const wall = (pts: V2[], z0: number, z1: number) =>
    d3([...pts.map(([a, b]): V3 => [a, b, z0]), ...pts.slice().reverse().map(([a, b]): V3 => [a, b, z1])]);

  // shaded rounded box: side / front / top fills + rim light on the near top edge
  function box(x: number, y: number, z: number, w: number, d: number, h: number, r = 0, c = "", topc = "rw-top") {
    r = Math.min(r, w / 2, d / 2);
    const z1 = z + h, k = c ? " " + c : "";
    const ring = [...arc(x + w - r, y + r, r, -H, 0), ...arc(x + w - r, y + d - r, r, 0, H), ...arc(x + r, y + d - r, r, H, 2 * H), ...arc(x + r, y + r, r, 2 * H, 3 * H)];
    const side = [...arc(x + w - r, y + r, r, -q, 0), ...arc(x + w - r, y + d - r, r, 0, q)];
    const front = [...arc(x + w - r, y + d - r, r, q, H), ...arc(x + r, y + d - r, r, H, 3 * q)];
    const lip = [...arc(x + w - r, y + r, r, -q, 0), ...arc(x + w - r, y + d - r, r, 0, H), ...arc(x + r, y + d - r, r, H, 3 * q)];
    const cx0 = x + w - r + r * Math.cos(q), cy0 = y + d - r + r * Math.sin(q);
    const [tx, ty] = P(cx0, cy0, z1), [, by] = P(cx0, cy0, z);
    const hw = h > 8 ? 0.8 : 0;
    const corner = hw ? `<path class="rw-corner" d="M${f(tx - hw)} ${f(ty)}H${f(tx + hw)}V${f(by)}H${f(tx - hw)}Z"/>` : "";
    return `<path class="rw-side${k}" d="${wall(side, z, z1)}"/><path class="rw-front${k}" d="${wall(front, z, z1)}"/>` + corner +
      `<path class="${topc}${k}" d="${d3(ring.map(([a, b]): V3 => [a, b, z1]))}"/><path class="rw-lip" d="${d3(lip.map(([a, b]): V3 => [a, b, z1]), false)}"/>`;
  }
  // upright cylinder (axis z)
  function cyl(cx: number, cy: number, z: number, r: number, h: number, c = "rw-cyl", topc = "rw-top") {
    const vis = arc(cx, cy, r, -q, 3 * q, 24), ring = arc(cx, cy, r, 0, 4 * H, 40);
    return `<path class="${c}" d="${wall(vis, z, z + h)}"/><path class="${topc}" d="${d3(ring.map(([a, b]): V3 => [a, b, z + h]))}"/>` +
      `<path class="rw-lip" d="${d3(vis.map(([a, b]): V3 => [a, b, z + h]), false)}"/>`;
  }
  // stacked copies of a face-local shape: solid thickness for coins, cards, discs
  function ext(tf: (i: number) => string, n: number, inner: string, face: string, edgeCls = "rw-edge") {
    let s = "";
    for (let i = 0; i < n; i++) s += `<g transform="${tf(i)}" class="${edgeCls}">${inner}</g>`;
    return s + `<g transform="${tf(n)}">${face}</g>`;
  }
  const ground = (cx: number, cy: number, rx: number, ry: number, pool = true) => `<g transform="${K.TOP(0, 0, 0)}">
    ${pool ? `<ellipse class="rw-pool" cx="${cx}" cy="${cy}" rx="${rx * 1.25}" ry="${ry * 1.25}"/>` : ""}
    <ellipse class="rw-shadow" cx="${cx + 6}" cy="${cy + 6}" rx="${rx}" ry="${ry}"/>
    <circle class="rw-ring" cx="${cx}" cy="${cy}" r="${(rx + ry) / 2 * 1.04}"/>
    <circle class="rw-ring2" cx="${cx}" cy="${cy}" r="${(rx + ry) / 2 * 1.24}"/></g>`;
  const dot = (x: number, y: number, z: number, r = 2.5, id = "") => {
    const p = P(x, y, z), a = Math.round(Math.random() * 90);
    return `<g ${id ? `id="${id}" ` : ""}><rect class="rw-dot" transform="translate(${f(p[0])} ${f(p[1])}) rotate(${a})" x="${-r * 0.8}" y="${-r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" rx=".3"/></g>`;
  };
  // sunken pocket: opening drawn as wall colour, floor shifted by the depth transform and clipped to the opening
  let rid = 0;
  function recess(shape: Shape, tf0: string, tf1: string, wallCls = "rw-wall", floorCls = "rw-pit", extra = "") {
    const id = "rwc" + rid++ + Math.random().toString(36).slice(2, 6);
    return `<clipPath id="${id}">${shape("", tf0)}</clipPath>${shape(wallCls, tf0)}<g clip-path="url(#${id})">${shape(floorCls, tf1)}${extra}</g>`;
  }
  const hull = (pts: V2[]) => {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: V2[] = [], up: V2[] = [];
    for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return "M" + lo.slice(0, -1).concat(up.slice(0, -1)).map((p) => p.map(f).join(" ")).join("L") + "Z";
  };
  const cone = (cx: number, cy: number, z: number, r0: number, r1: number, h: number) =>
    hull([...arc(cx, cy, r0, 0, 4 * H, 48).map(([a, b]) => P(a, b, z)), ...arc(cx, cy, r1, 0, 4 * H, 48).map(([a, b]) => P(a, b, z + h))]);
  // rising square motes appended to `el`; returns tick(t, level 0..1, speed)
  function motes(el: Element, { cx, cy, r, z0, h, n = 12, size = 1 }: { cx: number; cy: number; r: number; z0: number; h: number; n?: number; size?: number }) {
    n = Math.round(n * 1.4); size *= 1.15;
    const ps: { g: SVGGElement; x: number; y: number; off: number; spd: number; rot: number; spin: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 4 * H, rr = Math.sqrt(Math.random()) * r, s = (0.7 + Math.random() * 1.1) * size;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.innerHTML = `<rect class="rw-dot" x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s * (0.6 + Math.random() * 0.4)}" rx=".2"/>`;
      el.appendChild(g);
      ps.push({ g, x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), off: Math.random(), spd: 3200 + Math.random() * 2600, rot: Math.random() * 360, spin: (Math.random() - 0.5) * 200 });
    }
    return (t: number, level = 1, speed = 1) => ps.forEach((p) => {
      const u = ((t * speed / p.spd) + p.off) % 1, [px, py] = P(p.x, p.y, z0 + u * h);
      p.g.setAttribute("transform", `translate(${f(px)} ${f(py)}) rotate(${(p.rot + u * p.spin).toFixed(1)})`);
      p.g.style.opacity = (level * Math.min(1, u * 6) * (1 - u)).toFixed(2);
    });
  }
  // clip polygon for the vertical plane y = yc above height z (things sinking into a slot)
  const above = (id: string, yc: number, z: number) =>
    `<clipPath id="${id}"><polygon points="${[P(-400, yc, z), P(600, yc, z), P(600, yc, 600), P(-400, yc, 600)].map((p) => p.map(f).join(",")).join(" ")}"/></clipPath>`;
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dotp = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function ring3(c: V3, axis: V3, r: number, n = 40): V3[] {
    const a = unit(axis), u = unit(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(a, u);
    return Array.from({ length: n }, (_, i) => {
      const t = i / n * 4 * H, cs = Math.cos(t), sn = Math.sin(t);
      return [c[0] + r * (u[0] * cs + v[0] * sn), c[1] + r * (u[1] * cs + v[1] * sn), c[2] + r * (u[2] * cs + v[2] * sn)] as V3;
    });
  }
  const poly = (pts: V3[]) => "M" + pts.map((p) => P(...p).map(f).join(" ")).join("L") + "Z";
  function cylAx(c0: V3, c1: V3, r: number, side = "rw-cyl", cap = "rw-top") {
    const ax = sub(c1, c0), r0 = ring3(c0, ax, r), r1 = ring3(c1, ax, r);
    const capR = dotp(ax, [1, 1, 1]) > 0 ? r1 : r0;
    return `<path class="${side}" d="${hull([...r0, ...r1].map((p) => P(...p)))}"/><path class="${cap}" d="${poly(capR)}"/>`;
  }
  const coneAx = (c0: V3, c1: V3, r0: number, r1: number) =>
    hull([...ring3(c0, sub(c1, c0), r0), ...ring3(c1, sub(c1, c0), r1)].map((p) => P(...p)));
  return { d3, arc, wall, box, cyl, ext, ground, dot, recess, cone, motes, above, ring3, poly, cylAx, coneAx, hull };
}

/* ---------- motion helpers ---------- */

export const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };

/** Idle auto-play: run step() every `period` ms unless the viewer touched the figure recently. */
export function auto(api: { every: (ms: number, fn: () => void) => void }, stage: Element, period: number, step: () => void) {
  let last = -Infinity;
  const mark = () => { last = performance.now(); };
  stage.addEventListener("pointerdown", mark, true);
  api.every(period, () => { if (performance.now() - last > period + 2500) step(); });
  return mark;
}
