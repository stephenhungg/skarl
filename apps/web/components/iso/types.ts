import type { Frame, V3 } from "./kit";

export type IsoApi = {
  iso: {
    /** Kernel + viewBox fitted to the panel aspect. */
    frame: (points: V3[], margin?: number) => Frame;
    slits: (a0: number, a1: number, step: number, b0: number, b1: number, vertical?: boolean, cls?: string) => string;
    esc: (s: unknown) => string;
  };
  after: (ms: number, fn: () => void) => void;
  /** Skipped while offscreen; never runs under reduced motion. */
  every: (ms: number, fn: () => void) => void;
  /** fn(timestampMs) every frame while visible. Under reduced motion it runs once (rest state). */
  loop: (fn: (t: number) => void) => () => void;
  flash: (el: Element | null, ms?: number) => void;
  replay: (el: Element | null, cls?: string) => void;
  readout: (s: string) => void;
  /** Warm haze behind the figure while on. */
  power: (on: boolean) => void;
  reduced: boolean;
};

export type IsoHandle = { unmount?: () => void; demo?: () => void } | void;

export type IsoFigureDef = {
  id: string;
  aria: string;
  /** Extra CSS, scoped with `.iso-stage[data-fig="id"]`. */
  css?: string;
  mount: (stage: SVGSVGElement, api: IsoApi) => IsoHandle;
};
