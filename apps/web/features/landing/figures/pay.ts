import type { IsoFigureDef } from "@/components/iso/types";
import { auto, clamp01, ease, kit, mix, type V3 } from "@/components/iso/kit";

// Coin stacks beside a chain of three linked blocks. A coin lifts off the stack, arcs over and
// drops into the next block's slot; that block lights and the light cone moves to it.
export const payFigure: IsoFigureDef = {
  id: "pay",
  aria: "Isometric coin stacks beside a chain of three blocks. Coins drop into each block in turn and the block lights up.",
  css: `
    .iso-stage[data-fig="pay"] .pay-slot-floor { fill:${mix(8)}; transition:fill .3s; }
    .iso-stage[data-fig="pay"] .pay-blk.on .pay-slot-floor { fill:url(#rw-well); }
    .iso-stage[data-fig="pay"] .pay-strip { fill:${mix(24)}; transition:fill .3s; }
    .iso-stage[data-fig="pay"] .pay-blk.on .pay-strip { fill:url(#rw-themehi); }
    .iso-stage[data-fig="pay"] .pay-shalo { fill:url(#rw-theme); opacity:0; transition:opacity .3s; }
    .iso-stage[data-fig="pay"] .pay-blk.on .pay-shalo { opacity:.3; }
    .iso-stage[data-fig="pay"] .pay-glyph { fill:${mix(30)}; font-family:var(--mono); transition:fill .3s; }
    .iso-stage[data-fig="pay"] .pay-blk.on .pay-glyph { fill:var(--accent-hi); }
    .iso-stage[data-fig="pay"] .pay-blk.flash .rw-top { fill:url(#rw-themehi); }
    .iso-stage[data-fig="pay"] .pay-cone { transition:opacity .45s; }
    .iso-stage[data-fig="pay"] .pay-rim { fill:${mix(36)}; }
    .iso-stage[data-fig="pay"] .pay-edge { fill:${mix(22)}; }
    .iso-stage[data-fig="pay"] .pay-face { fill:url(#pay-faceg); }
    .iso-stage[data-fig="pay"] .pay-ring { fill:none; stroke:${mix(55)}; stroke-width:1.1; vector-effect:non-scaling-stroke; }
    .iso-stage[data-fig="pay"] .pay-sign { fill:var(--accent-hi); font-family:var(--mono); font-weight:600; }
    .iso-stage[data-fig="pay"] .pay-sign-top { fill:var(--accent-hi); font-family:var(--mono); }
    .iso-stage[data-fig="pay"] { cursor:pointer; }
  `,
  mount(stage, api) {
    const BW = 44, BD = 44, BH = 40, Y0 = 20, STEP = 60, ZT = BH + 6;   // blocks sit on a 6-high plinth
    const NBLK = 3, R = 12;
    const blk = (i: number) => ({ x: i * STEP, cx: i * STEP + BW / 2, cy: Y0 + BD / 2 });
    const STACKS: [number, number, number][] = [[-34, 104, 6], [-6, 120, 4]];
    const DOTS: V3[] = [[-40, 20, 110], [120, -30, 120], [200, 90, 30], [40, 150, 20]];
    const K = api.iso.frame([
      [0, Y0, 0], [blk(2).x + BW, Y0, 0], [blk(2).x + BW, Y0 + BD, 0], [0, Y0 + BD, 0],
      [-48, 120, 0], [-20, 134, 0], [-34, 104, 40],
      [blk(0).cx, blk(0).cy, ZT + 78], [blk(2).cx, blk(2).cy, ZT + 78], [blk(1).cx, blk(1).cy, ZT + 60],
    ], 0.06);
    const { P, D, TOP, FRONT } = K, G = kit(K);
    const f = (v: number) => v.toFixed(2);

    let svg = `<defs><radialGradient id="pay-faceg" cx=".4" cy=".35" r=".75"><stop offset="0" style="stop-color:${mix(30)}"/><stop offset="1" style="stop-color:${mix(10)}"/></radialGradient>
      <clipPath id="pay-clip"><polygon id="pay-clipp" points=""/></clipPath></defs>`;
    svg += G.ground(blk(1).cx - 10, blk(1).cy + 20, 120, 76);

    // chain: blocks back to front with links between them
    for (let i = 0; i < NBLK; i++) {
      const { x, cx, cy } = blk(i);
      let b = G.box(x - 3, Y0 - 3, 0, BW + 6, BD + 6, 6, 6);
      b += G.box(x, Y0, 6, BW, BD, BH, 6);
      const slot = (c: string, tf: string) => `<rect class="${c}" transform="${tf}" x="${cx - 15}" y="${cy - 3}" width="30" height="6" rx="3"/>`;
      b += G.recess(slot, TOP(0, 0, ZT), TOP(0, 0, ZT - 8), "rw-litwall", "pay-slot-floor");
      b += `<g transform="${TOP(0, 0, ZT)}"><rect class="rw-etch" x="${x + 6}" y="${Y0 + 6}" width="${BW - 12}" height="${BD - 12}" rx="3"/></g>`;
      b += `<g transform="${FRONT(x, Y0 + BD, ZT)}">
        <rect class="pay-shalo" x="5" y="${BH - 12}" width="${BW - 10}" height="9" rx="4.5"/>
        <rect class="pay-strip" x="9" y="${BH - 9.5}" width="${BW - 18}" height="3" rx="1.5"/>
        <text class="pay-glyph" x="${BW / 2}" y="${BH / 2 - 1}" font-size="15" text-anchor="middle">$</text></g>`;
      svg += `<g class="pay-blk" id="pay-b${i}">${b}</g>`;
      if (i < NBLK - 1) svg += G.box(x + BW, cy - 4, 18, STEP - BW, 8, 7, 2);
    }
    // light cone rising from the head block's slot (moved to the newest block)
    svg += `<g id="pay-cone" class="pay-cone"><path class="rw-cone" d="${G.cone(0, 0, ZT, 15, 26, 76)}"/></g>`;
    svg += `<g id="pay-motes"></g>`;

    // coin stacks: dark discs with lit rims, a $ on each top coin
    for (const [sx, sy, n] of STACKS) {
      for (let c = 0; c < n; c++) svg += G.cyl(sx, sy, c * 4, R, 3.4, "rw-litcyl", c === n - 1 ? "pay-face" : "rw-top");
      svg += `<g transform="${TOP(0, 0, n * 4 - 0.6)}"><circle class="pay-ring" cx="${sx}" cy="${sy}" r="${R - 3}"/>
        <circle class="rw-hi" cx="${sx}" cy="${sy}" r="3"/></g>`;
    }

    // the moving coin, built at the origin on the FRONT plane, thickness along +y
    const disc = `<circle r="${R}"/>`;
    const coin = G.ext((i) => FRONT(0, i * 1.3, 0), 4, disc, `
      <circle class="rw-halo" r="${R + 5}"/>
      <circle class="pay-rim" r="${R}"/><circle class="pay-face" r="${R - 2}"/><circle class="pay-ring" r="${R - 4.5}"/>
      <text class="pay-sign" x="0" y="4.4" font-size="12.5" text-anchor="middle">$</text>`, "pay-edge");
    svg += `<g id="pay-coinclip"><g id="pay-coin">${coin}</g></g>`;
    svg += DOTS.map((p, i) => G.dot(...p, i % 2 ? 1.6 : 2.2, "pay-d" + i)).join("");

    stage.setAttribute("viewBox", K.viewBox);
    stage.innerHTML = svg;
    const $ = (s: string) => stage.querySelector(s) as SVGElement;
    const blocks = [0, 1, 2].map((i) => $("#pay-b" + i)), cone = $("#pay-cone"), coinEl = $("#pay-coin");
    const coinClip = $("#pay-coinclip"), clipPoly = $("#pay-clipp");
    const dots = DOTS.map((_, i) => $("#pay-d" + i));
    const moteG = $("#pay-motes");
    const motes = [0, 1, 2].map((i) => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      moteG.appendChild(g);
      return G.motes(g, { cx: blk(i).cx, cy: blk(i).cy, r: 12, z0: ZT, h: 70, n: 7 });
    });

    const st = { head: 0, filled: 1, t0: -1e9, target: 1, landed: true, flash: -1e9 };
    const setCone = (i: number) => { const d = D(blk(i).cx, blk(i).cy, 0); cone.setAttribute("transform", `translate(${f(d[0])} ${f(d[1])})`); };
    const render = () => {
      blocks.forEach((b, i) => b.classList.toggle("on", i < st.filled));
      setCone(st.head);
      api.power(true);
    };
    const send = () => {
      if (!st.landed) return;
      if (st.filled >= NBLK) { st.filled = 0; render(); }
      st.target = st.filled; st.t0 = performance.now(); st.landed = false;
      coinClip.removeAttribute("clip-path");
    };

    const [sx, sy, sn] = STACKS[0];
    const START: V3 = [sx, sy - 1, sn * 4 + R + 2];
    api.loop((t) => {
      const e = t - st.t0, b = blk(st.target);
      const END: V3 = [b.cx, b.cy - 2, ZT + 34];
      let pos: V3 = START, op = 1;
      if (!st.landed) {
        if (e < 900) {
          const p = ease(e / 900);
          pos = [START[0] + (END[0] - START[0]) * p, START[1] + (END[1] - START[1]) * p, START[2] + (END[2] - START[2]) * p + Math.sin(p * Math.PI) * 26];
        } else {
          if (!coinClip.hasAttribute("clip-path")) {
            const yc = b.cy + 4;
            clipPoly.setAttribute("points", [P(-400, yc, ZT), P(600, yc, ZT), P(600, yc, 600), P(-400, yc, 600)].map((q) => q.map(f).join(",")).join(" "));
            coinClip.setAttribute("clip-path", "url(#pay-clip)");
          }
          const p = clamp01((e - 900) / 320);
          pos = [END[0], END[1], END[2] - (END[2] - (ZT - R - 4)) * p * p];
          if (p >= 1) {
            st.landed = true; st.filled = st.target + 1; st.head = st.target; st.flash = t;
            render();
          }
        }
      } else {
        // a fresh coin waits on top of the stack, fading in after a landing
        op = clamp01((t - st.flash - 300) / 400);
        if (coinClip.hasAttribute("clip-path")) coinClip.removeAttribute("clip-path");
        pos = [START[0], START[1], START[2] + Math.sin(t / 700) * 2];
      }
      const d = D(...pos);
      coinEl.setAttribute("transform", `translate(${f(d[0])} ${f(d[1])})`);
      coinEl.style.opacity = op.toFixed(2);
      blocks.forEach((bl, i) => bl.classList.toggle("flash", i === st.head && t - st.flash < 260));
      cone.style.opacity = (0.9 + Math.sin(t / 900) * 0.1 + (t - st.flash < 500 ? 0.3 : 0)).toFixed(2);
      motes.forEach((m, i) => m(t, i === st.head ? 1 : 0, t - st.flash < 900 ? 2 : 1));
      dots.forEach((el, i) => el.setAttribute("transform", `translate(0 ${(Math.sin(t / 900 + i * 1.7) * 4).toFixed(2)})`));
    });

    stage.addEventListener("click", send);
    render();
    auto(api, stage, 2600, send);
  },
};
