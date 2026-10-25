import type { IsoFigureDef } from "@/components/iso/types";
import { auto, clamp01, kit, mix, type V3 } from "@/components/iso/kit";

// A verifier terminal with two stacked screens: a film strip on top, a narration waveform below.
// A scan line sweeps both, then the side badge shows a lit check or a held mark, alternating.
export const checkFigure: IsoFigureDef = {
  id: "chk",
  aria: "Isometric verifier terminal. A scan line sweeps a film strip and a narration waveform, then a badge lights with a check or a held mark.",
  css: `
    .iso-stage[data-fig="chk"] .chk-scr { fill:url(#chk-scrg); }
    .iso-stage[data-fig="chk"] .chk-fr { fill:${mix(22)}; stroke:${mix(46)}; stroke-width:1; vector-effect:non-scaling-stroke; transition:fill .25s, stroke .25s; }
    .iso-stage[data-fig="chk"] .chk-fr.hot { fill:${mix(48)}; stroke:var(--accent-hi); }
    .iso-stage[data-fig="chk"] .chk-fi { fill:${mix(40)}; transition:fill .25s; }
    .iso-stage[data-fig="chk"] .chk-fr.hot + .chk-fi, .iso-stage[data-fig="chk"] .chk-fi.hot { fill:url(#rw-themehi); }
    .iso-stage[data-fig="chk"] .chk-sp { fill:${mix(10)}; }
    .iso-stage[data-fig="chk"] .chk-bar { fill:${mix(42)}; transition:fill .25s; }
    .iso-stage[data-fig="chk"] .chk-bar.hot { fill:url(#rw-themehi); }
    .iso-stage[data-fig="chk"] .chk-scan { fill:var(--accent-hi); }
    .iso-stage[data-fig="chk"] .chk-scanglow { fill:url(#rw-theme); opacity:.35; }
    .iso-stage[data-fig="chk"] .chk-sheet { fill:url(#chk-sheetg); }
    .iso-stage[data-fig="chk"] .chk-face { fill:${mix(16)}; transition:fill .3s; }
    .iso-stage[data-fig="chk"] .chk-face.ok { fill:url(#rw-well); }
    .iso-stage[data-fig="chk"] .chk-face.held { fill:${mix(26)}; }
    .iso-stage[data-fig="chk"] .chk-ring { fill:none; stroke:var(--accent-hi); stroke-width:1.6; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="chk"] .chk-tick { fill:none; stroke:${mix(10)}; stroke-width:3.4; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="chk"] .chk-hold { fill:var(--accent-hi); }
    .iso-stage[data-fig="chk"] .chk-bhalo { fill:url(#rw-theme); opacity:0; transition:opacity .3s; }
    .iso-stage[data-fig="chk"] .chk-bhalo.on { opacity:.38; }
    .iso-stage[data-fig="chk"] .chk-led { fill:${mix(26)}; } .iso-stage[data-fig="chk"] .chk-led.on { fill:url(#rw-themehi); }
    .iso-stage[data-fig="chk"] { cursor:pointer; }
  `,
  mount(stage, api) {
    const W = 150, D = 64, Z0 = 12, H = 108, ZT = Z0 + H;    // body
    const SX0 = 12, SX1 = W - 12, T0 = 12, T1 = 58, B0 = 66, B1 = 96;  // screens, face-local
    const BU = 32, BV = 42, BR = 19;                           // badge on the side face
    const DOTS: V3[] = [[-30, 30, 120], [120, -30, 140], [190, 80, 30], [10, 120, 20]];
    const K = api.iso.frame([
      [-6, -6, 0], [W + 6, -6, 0], [-6, D + 6, 0], [W + 6, D + 6, 0],
      [0, 0, ZT], [W, 0, ZT], [0, D + 30, ZT - 20], [W + 8, D - BU - BR, ZT - BV - BR], [W + 8, D - BU + BR, ZT - BV + BR],
    ], 0.07);
    const { TOP, FRONT, SIDE, plane } = K, G = kit(K);

    let svg = `<defs>
      <linearGradient id="chk-scrg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${mix(26)}"/><stop offset="1" style="stop-color:${mix(9)}"/></linearGradient>
      <linearGradient id="chk-sheetg" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--accent-hi);stop-opacity:.55"/><stop offset=".5" style="stop-color:var(--accent);stop-opacity:.2"/><stop offset="1" style="stop-color:var(--accent2);stop-opacity:0"/></linearGradient>
      <clipPath id="chk-clip"><rect x="${SX0}" y="${T0}" width="${SX1 - SX0}" height="${B1 - T0}"/></clipPath>
    </defs>`;
    svg += G.ground(W / 2, D / 2 + 6, 104, 70);
    svg += G.box(-6, -6, 0, W + 12, D + 12, 8, 12);
    svg += G.box(-2, -2, 8, W + 4, D + 4, 4, 10);
    svg += G.box(0, 0, Z0, W, D, H, 10);
    // top: etched lid, two status leds
    svg += `<g transform="${TOP(0, 0, ZT)}"><rect class="rw-etch" x="10" y="10" width="${W - 20}" height="${D - 20}" rx="6"/>
      <rect id="chk-led0" class="chk-led" x="${W - 44}" y="${D - 20}" width="12" height="4" rx="2"/>
      <rect id="chk-led1" class="chk-led" x="${W - 28}" y="${D - 20}" width="12" height="4" rx="2"/></g>`;

    // front face: two screens set into the face
    const F0 = FRONT(0, D, ZT), F1 = FRONT(0, D - 4, ZT);
    // film strip: 4 frames with sprocket holes
    const FW = 25, FG = 6, FX = SX0 + 8;
    let film = `<rect class="chk-sp" x="${SX0}" y="${T0 + 6}" width="${SX1 - SX0}" height="${T1 - T0 - 12}"/>`;
    for (let x = SX0 + 4; x < SX1 - 4; x += 7) film += `<rect class="rw-pit" x="${x}" y="${T0 + 8}" width="3.4" height="2.6" rx=".6"/><rect class="rw-pit" x="${x}" y="${T1 - 10.6}" width="3.4" height="2.6" rx=".6"/>`;
    for (let i = 0; i < 4; i++) {
      const x = FX + i * (FW + FG);
      film += `<g class="chk-cell" data-x="${x + FW / 2}"><rect class="chk-fr" x="${x}" y="${T0 + 13}" width="${FW}" height="${T1 - T0 - 26}" rx="1.5"/>
        <rect class="chk-fi" x="${x + 5 + (i % 2) * 2}" y="${T0 + 22 - (i % 3)}" width="9" height="7" rx="1"/></g>`;
    }
    // waveform: bars across the lower screen
    let wave = "";
    const NB = 30, bw = (SX1 - SX0 - 12) / NB, mid = (B0 + B1) / 2;
    for (let i = 0; i < NB; i++) {
      const a = Math.abs(Math.sin(i * 0.9) * 0.6 + Math.sin(i * 0.37 + 1) * 0.4), h = 3 + a * 20;
      const x = SX0 + 6 + i * bw;
      wave += `<rect class="chk-bar" data-x="${x + bw / 2}" x="${x + bw * 0.2}" y="${mid - h / 2}" width="${bw * 0.6}" height="${h}" rx="${bw * 0.3}"/>`;
    }
    const scr = (y0: number, y1: number) => (c: string, tf: string) =>
      `<rect class="${c}" transform="${tf}" x="${SX0}" y="${y0}" width="${SX1 - SX0}" height="${y1 - y0}" rx="4"/>`;
    svg += G.recess(scr(T0, T1), F0, F1, "rw-wall", "chk-scr", `<g transform="${F1}">${film}</g>`);
    svg += G.recess(scr(B0, B1), F0, F1, "rw-wall", "chk-scr", `<g transform="${F1}">${wave}</g>`);
    // scan line drawn on the face across both screens
    svg += `<g transform="${F0}"><g clip-path="url(#chk-clip)"><g id="chk-scan">
      <rect class="chk-scanglow" x="-5" y="${T0}" width="10" height="${B1 - T0}" rx="3"/>
      <rect class="chk-scan" x="-0.9" y="${T0}" width="1.8" height="${B1 - T0}"/></g></g>
      <rect class="rw-line" style="stroke-opacity:.75" x="${SX0}" y="${T0}" width="${SX1 - SX0}" height="${T1 - T0}" rx="4"/>
      <rect class="rw-line" style="stroke-opacity:.75" x="${SX0}" y="${B0}" width="${SX1 - SX0}" height="${B1 - B0}" rx="4"/>
      ${api.iso.slits(SX0 + 4, SX0 + 40, 4, 100, 104, true, "rw-etch")}</g>`;

    // side face: badge disc standing out from the face, vents, label
    svg += `<g transform="${SIDE(W, D, ZT)}">
      <circle id="chk-bhalo" class="chk-bhalo" cx="${BU}" cy="${BV}" r="${BR + 10}"/>
      ${api.iso.slits(14, 50, 4, 74, 96, true, "rw-etch")}</g>`;
    const disc = `<circle cx="${BU}" cy="${BV}" r="${BR}"/>`;
    svg += G.ext((i) => SIDE(W + i * 1.4, D, ZT), 5, disc, `
      <circle id="chk-face" class="chk-face" cx="${BU}" cy="${BV}" r="${BR}"/>
      <circle class="chk-ring" cx="${BU}" cy="${BV}" r="${BR - 3}"/>
      <path id="chk-tick" class="chk-tick" d="M${BU - 8} ${BV + 0.5} L${BU - 2.5} ${BV + 6} L${BU + 8.5} ${BV - 6}"/>
      <g id="chk-hold"><rect class="chk-hold" x="${BU - 6}" y="${BV - 7}" width="4" height="14" rx="1.2"/><rect class="chk-hold" x="${BU + 2}" y="${BV - 7}" width="4" height="14" rx="1.2"/></g>`);

    // light sheet thrown forward from the scan line (a vertical plane, moved per frame)
    svg += `<g id="chk-sheet"><g transform="${plane([0, D, ZT - T0], [0, 1, 0], [0, 0, -1])}">
      <rect class="chk-sheet" x="0" y="0" width="34" height="${B1 - T0}"/></g></g>`;
    svg += DOTS.map((p, i) => G.dot(...p, i % 2 ? 1.6 : 2.2, "chk-d" + i)).join("");

    stage.setAttribute("viewBox", K.viewBox);
    stage.innerHTML = svg;
    const $ = (s: string) => stage.querySelector(s) as SVGElement;
    const scan = $("#chk-scan"), sheet = $("#chk-sheet"), face = $("#chk-face"), tick = $("#chk-tick"), hold = $("#chk-hold"), bhalo = $("#chk-bhalo");
    const leds = [$("#chk-led0"), $("#chk-led1")];
    const items = [...stage.querySelectorAll<SVGElement>(".chk-fr, .chk-fi, .chk-bar")].map((el) => ({
      el, x: Number((el.closest(".chk-cell") as SVGElement | null)?.dataset.x ?? el.dataset.x),
    }));
    const dots = DOTS.map((_, i) => $("#chk-d" + i));

    const SWEEP = 2000;
    const st = { t0: -1e9, n: 0, verdict: "ok" as "ok" | "held" };
    const render = (scanning: boolean) => {
      const ok = !scanning && st.verdict === "ok", held = !scanning && st.verdict === "held";
      face.classList.toggle("ok", ok); face.classList.toggle("held", held);
      tick.style.display = held ? "none" : "";
      hold.style.display = held ? "" : "none";
      bhalo.classList.toggle("on", !scanning);
      leds[0].classList.toggle("on", scanning); leds[1].classList.toggle("on", ok);
      api.power(true);
    };
    const run = () => { st.t0 = performance.now(); st.n++; render(true); };

    let scanning = false;
    api.loop((t) => {
      const p = clamp01((t - st.t0) / SWEEP);
      const was = scanning;
      scanning = p < 1;
      // at rest the line parks near the right edge, lighting the whole strip
      const x = scanning ? SX0 + 2 + p * (SX1 - SX0 - 4) : SX1 - 6;
      scan.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
      const d = K.D(x, 0, 0);
      sheet.setAttribute("transform", `translate(${d[0].toFixed(2)} ${d[1].toFixed(2)})`);
      sheet.style.opacity = scanning ? "1" : "0.55";
      for (const it of items) it.el.classList.toggle("hot", it.x <= x);
      if (was && !scanning) { st.verdict = st.n % 2 ? "ok" : "held"; render(false); }
      dots.forEach((el, i) => el.setAttribute("transform", `translate(0 ${(Math.sin(t / 900 + i * 1.7) * 4).toFixed(2)})`));
    });

    stage.addEventListener("click", run);
    render(false);
    auto(api, stage, 3600, run);
    return { demo: () => render(false) };
  },
};
