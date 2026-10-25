import type { IsoFigureDef } from "@/components/iso/types";
import { auto, kit, mix, type V3 } from "@/components/iso/kit";

// A phone on a tripod filming a small desk: two cups, one on a target surface. Screen shows REC and a
// running timer; a light cone runs from the lens onto the desk.
export const recordFigure: IsoFigureDef = {
  id: "rec",
  aria: "Isometric phone on a tripod recording a desk with two cups and a target surface. Its screen shows a red record dot and a running timer.",
  css: `
    .iso-stage[data-fig="rec"] .rec-scr { fill:url(#rec-scrg); }
    .iso-stage[data-fig="rec"] .rec-dot { fill:#ff4f45; }
    .iso-stage[data-fig="rec"] .rec-dot-halo { fill:#ff4f45; opacity:.35; }
    .iso-stage[data-fig="rec"] .rec-txt { fill:var(--accent-hi); font-family:var(--mono); }
    .iso-stage[data-fig="rec"] .rec-mark { fill:none; stroke:var(--accent-hi); stroke-width:1.3; stroke-linecap:round; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="rec"] .rec-beam { transition:opacity .35s; }
    .iso-stage[data-fig="rec"] .rec-spot { fill:url(#rw-theme); opacity:.32; transition:opacity .35s; }
    .iso-stage[data-fig="rec"] .rec-spot.hot { opacity:.55; }
    .iso-stage[data-fig="rec"] .rec-halo { fill:url(#rw-theme); opacity:.14; transition:opacity .35s; }
    .iso-stage[data-fig="rec"] .rec-halo.hot { opacity:.22; }
    .iso-stage[data-fig="rec"] .rec-liquid { fill:${mix(30)}; }
    .iso-stage[data-fig="rec"] .rec-flash { fill:#fff; opacity:0; }
    .iso-stage[data-fig="rec"] { cursor:pointer; }
  `,
  mount(stage, api) {
    // phone: thin slab, screen on its SIDE face (x = PX + PW), lens on the hidden back
    const PX = 140, PY = 0, PW = 6, PD = 80, PZ = 62, PH = 48;
    const LENS: V3 = [PX - 1, PY + 18, PZ + PH - 10];
    const SPOT: V3 = [40, 36, 36];
    const DOTS: V3[] = [[-20, 60, 96], [110, -40, 120], [196, 90, 40], [20, 110, 16]];
    const K = api.iso.frame([
      [-4, -4, 0], [92, -4, 0], [-4, 82, 0], [92, 82, 0], [0, 0, 56],
      [PX, PY, PZ + PH], [PX + PW, PY + PD, PZ + PH], [PX + PW, PY, PZ + PH],
      [118, 20, 0], [178, 44, 0], [146, 84, 0],
    ], 0.06);
    const { P, TOP, SIDE } = K, G = kit(K);
    const f = (v: number) => v.toFixed(1);
    const l0 = P(...LENS), l1 = P(...SPOT);

    let svg = `<defs>
      <linearGradient id="rec-scrg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:${mix(34)}"/><stop offset="1" style="stop-color:${mix(14)}"/></linearGradient>
      <linearGradient id="rec-beamg" gradientUnits="userSpaceOnUse" x1="${f(l0[0])}" y1="${f(l0[1])}" x2="${f(l1[0])}" y2="${f(l1[1])}">
        <stop offset="0" style="stop-color:var(--accent-hi);stop-opacity:.85"/>
        <stop offset=".55" style="stop-color:var(--accent);stop-opacity:.42"/>
        <stop offset="1" style="stop-color:var(--accent2);stop-opacity:.2"/></linearGradient>
    </defs>`;
    svg += G.ground(80, 40, 96, 64);

    // desk: four legs, then the top slab
    for (const [x, y] of [[2, 2], [78, 2], [2, 70], [78, 70]]) svg += G.box(x, y, 0, 6, 6, 30, 1.5);
    svg += G.box(-4, -4, 30, 96, 86, 6, 6);
    svg += `<g transform="${TOP(0, 0, 36)}"><rect class="rw-etch" x="4" y="4" width="80" height="70" rx="4"/></g>`;
    // where the light lands
    svg += `<g transform="${TOP(0, 0, 36.2)}"><ellipse id="rec-spot" class="rec-spot" cx="${SPOT[0]}" cy="${SPOT[1]}" rx="34" ry="30"/>
      <ellipse class="rw-hi" style="opacity:.35" cx="${SPOT[0]}" cy="${SPOT[1]}" rx="18" ry="15"/></g>`;
    // cup on the left, target surface + cup at the back
    const cup = (cx: number, cy: number, z: number, r: number, h: number) =>
      G.cyl(cx, cy, z, r, h) + `<g transform="${TOP(0, 0, z + h)}"><circle class="rw-pit" cx="${cx}" cy="${cy}" r="${r - 1.6}"/>
        <circle class="rec-liquid" cx="${cx}" cy="${cy}" r="${r - 3.2}"/></g>`;
    svg += G.cyl(60, 22, 36, 13, 2.2, "rw-litcyl", "rw-hi");
    svg += cup(60, 22, 38.2, 8.5, 15);
    svg += cup(24, 50, 36, 9, 17);

    // light cone from the lens to the desk
    svg += `<g id="rec-beam" class="rec-beam"><path style="fill:url(#rec-beamg)" d="${G.coneAx(LENS, SPOT, 4, 30)}"/></g>`;
    svg += `<g id="rec-motes"></g>`;

    // tripod: three legs to a hub, a short column, a clamp
    const HUB: V3 = [PX + 3, PY + PD / 2, 50];
    for (const foot of [[118, 20, 0], [178, 44, 0], [146, 84, 0]] as V3[]) svg += G.cylAx(foot, HUB, 1.8);
    svg += G.cyl(HUB[0], HUB[1], 46, 5, 8);
    svg += G.cylAx([HUB[0], HUB[1], 54], [HUB[0], HUB[1], PZ - 4], 2.4);
    svg += G.box(PX - 2, PY + PD / 2 - 12, PZ - 5, PW + 4, 24, 5, 2);

    // phone: halo behind it, body, screen recess on the side face
    const SF = SIDE(PX + PW, PY + PD, PZ + PH);
    svg += `<g transform="${SIDE(PX + PW + 0.5, PY + PD, PZ + PH)}"><rect id="rec-halo" class="rec-halo" x="-3" y="-3" width="${PD + 6}" height="${PH + 6}" rx="7"/></g>`;
    svg += G.box(PX, PY, PZ, PW, PD, PH, 3);
    const scr = (c: string, tf: string) => `<rect class="${c}" transform="${tf}" x="4" y="4" width="${PD - 8}" height="${PH - 8}" rx="4"/>`;
    const SF1 = SIDE(PX + PW - 1.4, PY + PD, PZ + PH);
    const W = PD - 8, Hs = PH - 8;
    const ui = `<g transform="${SF1}">
      <rect id="rec-flash" class="rec-flash" x="4" y="4" width="${W}" height="${Hs}" rx="4"/>
      <circle class="rec-dot-halo" id="rec-dothalo" cx="13" cy="13" r="5.5"/>
      <circle class="rec-dot" id="rec-dot" cx="13" cy="13" r="3.4"/>
      <text class="rec-txt" x="20" y="16" font-size="8" letter-spacing=".6">REC</text>
      <text class="rec-txt" id="rec-time" x="${W}" y="16" font-size="8" text-anchor="end" letter-spacing=".4">00:00</text>
      <path class="rec-mark" d="M14 ${Hs - 6}v6h6M${W - 6} ${Hs - 6}v6h-6M14 30v-6h6M${W - 6} 30v-6h-6"/>
      <rect class="rw-hi" x="26" y="${Hs - 1}" width="${W - 44}" height="3" rx="1.5" opacity=".45"/>
      <rect id="rec-bar" class="rw-hi" x="26" y="${Hs - 1}" width="10" height="3" rx="1.5"/>
    </g>`;
    svg += G.recess(scr, SF, SF1, "rw-wall", "rec-scr", ui);
    svg += `<g transform="${SF}"><rect class="rw-line" style="stroke-opacity:.8" x="4" y="4" width="${W}" height="${Hs}" rx="4"/></g>`;

    svg += DOTS.map((p, i) => G.dot(...p, i % 2 ? 1.6 : 2.2, "rec-d" + i)).join("");

    stage.setAttribute("viewBox", K.viewBox);
    stage.innerHTML = svg;
    const $ = (s: string) => stage.querySelector(s) as SVGElement;
    const beam = $("#rec-beam"), spot = $("#rec-spot"), halo = $("#rec-halo"), dotEl = $("#rec-dot"), dotHalo = $("#rec-dothalo");
    const time = $("#rec-time"), bar = $("#rec-bar"), flashEl = $("#rec-flash");
    const dots = DOTS.map((_, i) => $("#rec-d" + i));
    const tickMotes = G.motes($("#rec-motes"), { cx: SPOT[0] + 10, cy: SPOT[1], r: 24, z0: 38, h: 60, n: 10 });

    const st = { on: true, t0: performance.now() - 42000, acc: 0, shot: -1e9 };
    const render = () => { spot.classList.toggle("hot", st.on); halo.classList.toggle("hot", st.on); api.power(st.on); };
    const toggle = () => {
      if (st.on) { st.acc += performance.now() - st.t0; st.on = false; }
      else { st.t0 = performance.now(); st.on = true; }
      render();
    };
    const clip = () => { if (!st.on) toggle(); st.shot = performance.now(); };

    let lastSec = -1;
    api.loop((t) => {
      const ms = st.acc + (st.on ? t - st.t0 : 0), sec = Math.floor(ms / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        time.textContent = `${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
      }
      const blink = st.on ? (Math.floor(t / 600) % 2 ? 0.25 : 1) : 0.15;
      dotEl.style.opacity = String(blink); dotHalo.style.opacity = String(blink * 0.4);
      bar.setAttribute("width", String(4 + (((ms / 9000) % 1) * (W - 48))));
      const k = Math.max(0, 1 - (t - st.shot) / 500);
      flashEl.style.opacity = (k * 0.35).toFixed(2);
      beam.style.opacity = ((st.on ? 0.82 + Math.sin(t / 900) * 0.1 : 0.35) + k * 0.4).toFixed(2);
      tickMotes(t, st.on ? 1 : 0.3, 1 + k);
      dots.forEach((el, i) => el.setAttribute("transform", `translate(0 ${(Math.sin(t / 900 + i * 1.7) * 4).toFixed(2)})`));
    });

    stage.addEventListener("click", toggle);
    render();
    auto(api, stage, 3400, clip);
  },
};
