import type { IsoFigureDef } from "@/components/iso/types";
import { auto, clamp01, ease, kit, mix, type V2, type V3 } from "@/components/iso/kit";

// A desk stamp over a sheet on a signing pad. It comes down, a lit approval mark lands on the
// sheet and a sheet of light spreads out from the impact.
export const approveFigure: IsoFigureDef = {
  id: "apr",
  aria: "Isometric desk stamp over a sheet of paper. The stamp comes down and leaves a lit approval mark.",
  css: `
    .iso-stage[data-fig="apr"] .apr-ink.rw-side, .iso-stage[data-fig="apr"] .apr-ink.rw-front { fill:url(#rw-lit); }
    .iso-stage[data-fig="apr"] .apr-ink.rw-top { fill:url(#rw-themehi); }
    .iso-stage[data-fig="apr"] .apr-mark { fill:none; stroke:var(--accent-hi); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="apr"] .apr-markfill { fill:url(#rw-theme); opacity:.32; }
    .iso-stage[data-fig="apr"] .apr-glow { fill:url(#rw-theme); opacity:.2; }
    .iso-stage[data-fig="apr"] .apr-ring { fill:url(#rw-theme); fill-opacity:.22; stroke:var(--accent-hi); stroke-width:1.4; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="apr"] .apr-col { fill:url(#apr-colg); }
    .iso-stage[data-fig="apr"] .apr-line { fill:none; stroke:${mix(8)}; stroke-width:1.6; stroke-linecap:round; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="apr"] .apr-strip { fill:url(#rw-themehi); }
    .iso-stage[data-fig="apr"] .apr-num { fill:var(--accent-hi); font-family:var(--mono); }
    .iso-stage[data-fig="apr"] { cursor:pointer; }
  `,
  mount(stage, api) {
    const PW = 176, PD = 124;                 // pad
    const ZP = 14.6;                           // paper top
    const SX = 92, SY = 70, SW = 46, SD = 30;  // stamp centre and plate
    const REST = 50;                           // plate bottom at rest
    const DOTS: V3[] = [[-10, 40, 110], [140, -20, 130], [190, 120, 40], [30, 140, 30]];
    const K = api.iso.frame([
      [0, 0, 0], [PW, 0, 0], [0, PD, 0], [PW, PD, 0],
      [SX - 16, SY - 16, REST + 50], [SX + 16, SY - 16, REST + 50], [SX - 16, SY + 16, REST + 44],
    ], 0.07);
    const { P, D, TOP, FRONT } = K, G = kit(K);

    let svg = `<defs><linearGradient id="apr-colg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--accent-hi);stop-opacity:.5"/><stop offset=".45" style="stop-color:var(--accent);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--accent2);stop-opacity:.08"/></linearGradient></defs>`;
    svg += G.ground(PW / 2, PD / 2, 110, 84);
    // pad, felt deck, lit strip + counter on the front
    svg += G.box(0, 0, 0, PW, PD, 10, 14);
    svg += G.box(8, 8, 10, PW - 16, PD - 16, 3, 9);
    svg += `<g transform="${FRONT(0, PD, 10)}"><rect class="rw-halo" x="14" y="1.5" width="64" height="7" rx="3.5"/><rect class="apr-strip" x="18" y="3.5" width="56" height="3" rx="1.5"/>
      <text id="apr-num" class="apr-num" x="${PW - 18}" y="7.4" font-size="6.5" text-anchor="end" letter-spacing=".6">017</text></g>`;
    // sheet: thin, light, a few printed lines and a signature line
    svg += G.box(34, 16, 13, 104, 96, 1.6, 2, "", "rw-paper");
    svg += `<g transform="${TOP(0, 0, ZP)}">
      <path class="apr-line" d="M44 26H110M44 33H124M44 40H96"/>
      <path class="apr-line" d="M44 100H86"/>
      <path class="apr-line" style="stroke:${mix(55)};stroke-width:1.3" d="M46 96c4-6 7 4 11-2s6 3 10-1"/>
      <ellipse class="apr-glow" id="apr-glow" cx="${SX}" cy="${SY}" rx="40" ry="32"/>
      <rect id="apr-ring" class="apr-ring" x="${SX - SW / 2}" y="${SY - SD / 2}" width="${SW}" height="${SD}" rx="5" style="opacity:0"/>
      <g id="apr-mark">
        <rect class="apr-markfill" x="${SX - SW / 2 + 2}" y="${SY - SD / 2 + 2}" width="${SW - 4}" height="${SD - 4}" rx="4"/>
        <rect class="apr-mark" x="${SX - SW / 2 + 2}" y="${SY - SD / 2 + 2}" width="${SW - 4}" height="${SD - 4}" rx="4"/>
        <path class="apr-mark" style="stroke-width:3" d="M${SX - 9} ${SY + 1} L${SX - 3} ${SY + 7} L${SX + 10} ${SY - 6}"/>
      </g></g>`;
    svg += `<path id="apr-col" class="apr-col" d=""/><g id="apr-motes"></g>`;

    // stamp, built at rest height and moved as one group
    const z = REST;
    const k = P(SX, SY, z + 36);
    let stamp = `<circle class="rw-halo" style="opacity:.14" cx="${k[0].toFixed(2)}" cy="${k[1].toFixed(2)}" r="30"/>`;
    stamp += G.box(SX - SW / 2 + 1, SY - SD / 2 + 1, z, SW - 2, SD - 2, 3, 4, "apr-ink");
    stamp += G.box(SX - SW / 2, SY - SD / 2, z + 3, SW, SD, 12, 5);
    stamp += G.cyl(SX, SY, z + 15, 9, 9);
    // chunky handle: a short flared drum with a lit dome on top
    stamp += G.cyl(SX, SY, z + 24, 13, 4);
    stamp += G.cyl(SX, SY, z + 28, 16, 14);
    stamp += `<g transform="${TOP(0, 0, z + 42)}"><circle class="rw-orb" cx="${SX}" cy="${SY}" r="15"/><circle class="rw-lip" cx="${SX}" cy="${SY}" r="10"/></g>`;
    svg += `<g id="apr-stamp">${stamp}</g>`;
    svg += DOTS.map((p, i) => G.dot(...p, i % 2 ? 1.6 : 2.2, "apr-d" + i)).join("");

    stage.setAttribute("viewBox", K.viewBox);
    stage.innerHTML = svg;
    const $ = (s: string) => stage.querySelector(s) as SVGElement;
    const stampEl = $("#apr-stamp"), col = $("#apr-col"), mark = $("#apr-mark"), ring = $("#apr-ring"), glow = $("#apr-glow"), num = $("#apr-num");
    const dots = DOTS.map((_, i) => $("#apr-d" + i));
    const tickMotes = G.motes($("#apr-motes"), { cx: SX, cy: SY, r: 22, z0: ZP + 2, h: 50, n: 9 });

    // light column between the plate and the sheet: hull of the two rectangles
    const rectPts = (zz: number, grow: number): V2[] => [
      [SX - SW / 2 - grow, SY - SD / 2 - grow], [SX + SW / 2 + grow, SY - SD / 2 - grow],
      [SX + SW / 2 + grow, SY + SD / 2 + grow], [SX - SW / 2 - grow, SY + SD / 2 + grow],
    ].map(([x, y]) => P(x, y, zz));

    const st = { t0: -1e9, count: 17, hit: false, impact: -1e9 };
    const stampIt = () => { if (performance.now() - st.t0 < 1300) return; st.t0 = performance.now(); st.hit = false; };

    api.loop((t) => {
      const e = t - st.t0;
      // lift a little, slam down, hold, rise
      let lift = 0;
      if (e < 260) lift = 6 * ease(e / 260);
      else if (e < 440) lift = 6 - (REST - ZP + 6) * Math.pow((e - 260) / 180, 2);
      else if (e < 600) lift = -(REST - ZP);
      else if (e < 1200) lift = -(REST - ZP) * (1 - ease((e - 600) / 600));
      lift += e > 1200 ? Math.sin(t / 800) * 2 : 0;
      if (!st.hit && e >= 440 && e < 1200) {
        st.hit = true; st.impact = t; st.count++;
        num.textContent = String(st.count).padStart(3, "0");
        api.power(true);
      }
      const dd = D(0, 0, lift);
      stampEl.setAttribute("transform", `translate(${dd[0].toFixed(2)} ${dd[1].toFixed(2)})`);
      const bottom = REST + lift;
      col.setAttribute("d", bottom - ZP > 3 ? G.hull([...rectPts(bottom, -1), ...rectPts(ZP, 6)]) : "");
      col.style.opacity = clamp01((bottom - ZP) / 20).toFixed(2);
      // mark: fades while the next stamp lifts, relights on impact
      const sinceHit = t - st.impact;
      mark.style.opacity = (e >= 0 && e < 440 ? 1 - clamp01(e / 260) : 1).toFixed(2);
      // light sheet spreading from the impact
      const r = clamp01(sinceHit / 700);
      const g = 1 + r * 1.3;
      ring.setAttribute("transform", `translate(${SX} ${SY}) scale(${g.toFixed(3)}) translate(${-SX} ${-SY})`);
      ring.style.opacity = sinceHit < 700 ? (1 - r).toFixed(2) : "0";
      glow.style.opacity = (0.22 + (sinceHit < 900 ? (1 - sinceHit / 900) * 0.5 : 0)).toFixed(2);
      tickMotes(t, 0.6 + (sinceHit < 900 ? 0.4 : 0), sinceHit < 900 ? 2 : 1);
      dots.forEach((el, i) => el.setAttribute("transform", `translate(0 ${(Math.sin(t / 900 + i * 1.7) * 4).toFixed(2)})`));
    });

    stage.addEventListener("click", stampIt);
    api.power(true);
    auto(api, stage, 3000, stampIt);
  },
};
