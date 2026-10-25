"use client";

import { useEffect, useMemo, useRef } from "react";
import { geoCentroid, geoGraticule, geoOrthographic, geoPath } from "d3-geo";
type MultiPolygon = { type: "MultiPolygon"; coordinates: [number, number][][][] };
import countries from "./countries.json";
import { receiptPalette } from "./hash";
import styles from "./visuals.module.css";

type Country = { code: string; iso2: string; rings: [number, number][][] };

const COUNTRIES = countries as Country[];

const toMultiPolygon = (c: Country): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: c.rings.map((ring) => [ring]),
});

export type GlobeProps = {
  /** ISO 3166 alpha-2 (e.g. "PH") or alpha-3 (e.g. "PHL"). */
  countryCode: string;
  /** Country name, only used in the accessible label. */
  countryName?: string;
  /** Live receipt layout (globe stretches to fill the geo card column). */
  live?: boolean;
  className?: string;
};

export function Globe({ countryCode, countryName, live = true, className }: GlobeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const code = countryCode.toUpperCase();
  const country = useMemo(
    () => COUNTRIES.find((c) => c.iso2 === code || c.code === code),
    [code],
  );
  // Center on the spherical centroid of the country's boundary.
  const center = useMemo(
    () => (country ? (geoCentroid(toMultiPolygon(country)) as [number, number]) : undefined),
    [country],
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const r = Math.min(0.41 * w, 0.43 * h);
      const cx = w / 2;
      const cy = h / 2;
      const [lon, lat] = center ?? [0, 20];
      const projection = geoOrthographic()
        .scale(249.5)
        .clipAngle(90 + 1e-6)
        .rotate([-lon, -lat])
        .translate([cx, cy])
        .scale(r)
        .precision(0.2);
      const path = geoPath(projection, ctx);

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.clip();

      const style = getComputedStyle(canvas);
      const hueRaw = style.getPropertyValue("--receipt-hue").trim();
      const hue = Number(hueRaw);
      const pal = receiptPalette(hueRaw && Number.isFinite(hue) ? hue : 100);
      const accent = style.getPropertyValue("--receipt-accent").trim() || "#a9d97f";
      const accentInk = style.getPropertyValue("--receipt-accent-ink").trim() || "#2c3a1a";

      const sphere = ctx.createRadialGradient(cx - 0.4 * r, cy - 0.5 * r, 0.1 * r, cx, cy, r);
      sphere.addColorStop(0, pal.white);
      sphere.addColorStop(0.72, pal.soft);
      sphere.addColorStop(1, pal.edge);
      ctx.fillStyle = sphere;
      ctx.fillRect(0, 0, w, h);

      // 4px tile with one dot: the stipple over land.
      const tile = document.createElement("canvas");
      tile.width = 4;
      tile.height = 4;
      const tctx = tile.getContext("2d");
      if (tctx) {
        tctx.fillStyle = pal.ink;
        tctx.beginPath();
        tctx.arc(2, 2, 0.65, 0, 2 * Math.PI);
        tctx.fill();
      }
      const stipple = ctx.createPattern(tile, "repeat");

      for (const c of COUNTRIES) {
        const selected = country !== undefined && c.code === country.code;
        ctx.beginPath();
        path(toMultiPolygon(c));
        ctx.fillStyle = selected ? accent : pal.land;
        ctx.fill();
        if (!selected && stipple) {
          ctx.fillStyle = stipple;
          ctx.fill();
        }
        ctx.strokeStyle = selected ? accentInk : pal.boundary;
        ctx.lineWidth = selected ? 1 : 0.45;
        ctx.stroke();
      }

      ctx.strokeStyle = pal.graticule;
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      path(geoGraticule()());
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 0.65;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r + 8, 0, 2 * Math.PI);
      ctx.strokeStyle = pal.ring;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // Bezel ticks: 72 around, every 6th one longer and darker.
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const major = i % 6 === 0;
        const outer = r + (major ? 14 : 11);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        ctx.strokeStyle = major ? pal.outline : pal.grid;
        ctx.lineWidth = major ? 0.8 : 0.5;
        ctx.stroke();
      }

      if (center) {
        // Corner brackets and a center dot.
        ctx.strokeStyle = accentInk;
        ctx.lineWidth = 0.9;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(cx + 7 * sx, cy + 13 * sy);
          ctx.lineTo(cx + 13 * sx, cy + 13 * sy);
          ctx.lineTo(cx + 13 * sx, cy + 7 * sy);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = accentInk;
        ctx.fill();
      }
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [country, center]);

  const label = center
    ? `Globe centered on ${countryName ?? code}, with its country boundary highlighted.`
    : "World globe; no country boundary available.";

  return (
    <canvas
      ref={ref}
      className={[styles.globe, live && styles.globeLive, className].filter(Boolean).join(" ")}
      role="img"
      aria-label={`${label} Country-level geography, not exact capture coordinates.`}
    />
  );
}
