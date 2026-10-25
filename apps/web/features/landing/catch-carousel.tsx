import { SectionHeader } from "@/components/section-header";
import { CatchCarousel } from "./catch/carousel";

const CARD_EASE = "cubic-bezier(.64,.39,.23,.88)";

// Geometry and timing ported from the Kled-style stories carousel: 750x500 center card,
// neighbors at scale .95 and opacity .75, 0.75s slide, an edge mask fading the neighbors (linear, so the dark center card keeps full tone).
const css = `
.skc-root{--skc-cw:750px;--skc-ch:500px}
.skc-track{position:relative;width:100%;height:var(--skc-ch);display:flex;align-items:center;justify-content:center;overflow:visible;outline:none;touch-action:pan-y;--skc-mask:linear-gradient(90deg,#0000 0%,#000 calc(50% - var(--skc-cw) / 2 - 24px),#000 calc(50% + var(--skc-cw) / 2 + 24px),#0000 100%);-webkit-mask-image:var(--skc-mask);mask-image:var(--skc-mask)}
.skc-track:focus-visible .skc-slot[data-pos="center"] .skc-frame{outline:2px solid rgb(var(--accent));outline-offset:2px}
.skc-rail{position:relative;width:var(--skc-cw);height:100%;display:flex;align-items:center;justify-content:center}
.skc-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:translateX(calc(var(--skc-o) * var(--skc-cw))) scale(var(--skc-s));transition:transform .75s var(--ease-slide),opacity .75s var(--ease-slide);user-select:none;-webkit-user-select:none;outline:none}
.skc-slot[data-pos="center"]{opacity:1;z-index:10}
.skc-slot[data-pos="side"]{opacity:.75;z-index:5;cursor:pointer}
.skc-slot[data-pos="side"]:hover{opacity:.9}
.skc-slot[data-pos="off"]{opacity:0;z-index:0;pointer-events:none}
.skc-slot-inner{width:100%;height:100%}

.skc-card{position:relative;display:flex;flex-direction:column;width:100%;height:100%;padding:0;border-radius:16px;text-decoration:none;color:inherit;transition:padding .55s ${CARD_EASE}}
.skc-card::after{content:"";position:absolute;inset:0;box-sizing:border-box;border:2px solid transparent;border-radius:inherit;pointer-events:none;transition:border-color .55s ${CARD_EASE}}
.skc-frame{position:relative;flex:1 0 0;min-height:0;width:100%;overflow:hidden;border-radius:12px;background:rgb(var(--ink));color:rgb(var(--paper))}
.skc-body{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;padding:32px}
.skc-chip{display:inline-flex;align-items:center;padding:3px 6px;border-radius:6px;font-size:12px;line-height:1;background:rgb(var(--paper) / .14);color:rgb(var(--paper) / .85)}
.skc-title{margin:0;max-width:560px;font-size:24px;letter-spacing:.01em;line-height:1.2;color:rgb(var(--paper))}
.skc-arrow{position:absolute;right:32px;top:28px;z-index:3;width:24px;height:24px;overflow:visible;pointer-events:none}
.skc-arrow-slide{position:absolute;top:0;bottom:0;left:-30px;width:24px;opacity:0;filter:blur(8px);transition:left .55s ${CARD_EASE},opacity .55s ${CARD_EASE},filter .55s ${CARD_EASE}}
.skc-arrow-turn{width:24px;height:24px;transition:transform .55s ${CARD_EASE}}
.skc-arrow-turn svg{display:block}
.skc-slot[data-pos="center"] .skc-card[data-link]:hover{padding:6px}
.skc-slot[data-pos="center"] .skc-card[data-link]:hover::after{border-color:rgb(var(--haze) / .75)}
.skc-slot[data-pos="center"] .skc-card[data-link]:hover .skc-arrow-slide{left:0;opacity:1;filter:blur(0)}
.skc-slot[data-pos="center"] .skc-card[data-link]:hover .skc-arrow-turn{transform:rotate(90deg)}

.skc-nav{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;background:rgb(var(--mist));color:rgb(var(--deep));cursor:pointer;transition:background-color .4s var(--ease-hover)}
.skc-nav:hover{background:rgb(var(--haze))}

@media (max-width:1199.98px){
  .skc-root{--skc-cw:600px;--skc-ch:460px}
  .skc-body{padding:24px}
  .skc-title{font-size:22px}
}
@media (max-width:809.98px){
  .skc-root{--skc-cw:calc(100vw - 36px);--skc-ch:480px}
  .skc-track{-webkit-mask-image:none;mask-image:none}
  .skc-body{padding:18px}
  .skc-title{font-size:18px}
}
@media (prefers-reduced-motion:reduce){
  .skc-slot,.skc-card,.skc-arrow-slide,.skc-arrow-turn{transition:none}
}
`;

export function CatchSection() {
  return (
    <section id="the-catch" className="skc-root relative flex w-full flex-col items-center gap-8 overflow-x-clip py-[72px]" aria-labelledby="catch-title">
      <style>{css}</style>
      <div className="frame">
        <SectionHeader id="catch-title" eyebrow="Verification" title="How Skarl checks a clip" />
      </div>
      <CatchCarousel />
    </section>
  );
}
