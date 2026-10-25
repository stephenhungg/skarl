"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

export interface VerticalReelItem {
  src: string;
  alt: string;
  title?: string;
  subtitle?: string;
  href?: string;
}

export type VerticalReelDirection = "horizontal" | "vertical";
export type VerticalReelAutoplay = "step" | "spin" | "drift" | "off";

export interface VerticalReelProps {
  items?: VerticalReelItem[];
  startIndex?: number;
  direction?: VerticalReelDirection;
  aspect?: number;
  size?: number;
  curvature?: number;
  distance?: number;
  tilt?: number;
  gap?: number;
  radius?: number;
  dim?: number;
  edgeFade?: number;
  motionBlur?: number;
  friction?: number;
  snap?: boolean;
  autoplay?: VerticalReelAutoplay;
  speed?: number;
  interval?: number;
  pauseOnHover?: boolean;
  draggable?: boolean;
  wheel?: boolean;
  captions?: boolean;
  backgroundColor?: string;
  paused?: boolean;
  dpr?: number;
  ariaLabel?: string;
  onIndexChange?: (index: number) => void;
  onSelect?: (item: VerticalReelItem, index: number) => void;
  className?: string;
  style?: CSSProperties;
}

export interface VerticalReelHandle {
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  spin: (cards: number) => void;
}

type Settings = Required<
  Omit<
    VerticalReelProps,
    "className" | "style" | "onIndexChange" | "onSelect" | "ariaLabel" | "startIndex" | "items"
  >
> & {
  reduced: boolean;
  held: boolean;
};

interface Controller {
  sync: () => void;
  step: (direction: number) => void;
  goTo: (index: number) => void;
  spin: (cards: number) => void;
  destroy: () => void;
}

interface Callbacks {
  onActive: (index: number) => void;
  onSelect: (index: number) => void;
}

interface Overlay {
  caption: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
}

interface Layer {
  image: HTMLImageElement | HTMLVideoElement;
  /** Video layers are redrawn from the playing element every few frames so the card animates. */
  video: boolean;
  /** Still frame shown on a video card until the video has a frame to draw. */
  poster?: HTMLImageElement;
  /** Set when a playing video has a newer frame; the card keeps its last frame until it is redrawn. */
  stale?: boolean;
  lastDraw: number;
  ready: boolean;
  drawn: boolean;
  aspect: number;
  fade: number;
}

const MAX_ITEMS = 32;
const MAX_SAMPLES = 28;
const CAPTION_GAP = 26;
const CAPTION_HEIGHT = 44;
const TAU = Math.PI * 2;

const defaultItems: VerticalReelItem[] = [
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-amber-loop.webp",
    alt: "Tilted golden-amber loop on a grainy raspberry-purple field",
    title: "Amber loop",
    subtitle: "Warmth around an open center",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-pink-eclipse.webp",
    alt: "Coral-pink disc crossing a violet diagonal plane on a grainy purple field",
    title: "Pink eclipse",
    subtitle: "A disc across the diagonal",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-plum-ribbon.webp",
    alt: "Intersecting pink and plum diagonal ribbons on a coral-magenta field",
    title: "Plum ribbon",
    subtitle: "Two ribbons, one crossing",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-violet-steps.webp",
    alt: "Three interlocking violet and pink stepped planes with an amber edge",
    title: "Violet steps",
    subtitle: "Three planes in rhythm",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-rose-balance.webp",
    alt: "Tilted raspberry rounded rectangle and tangerine disc on a rose-pink field",
    title: "Rose balance",
    subtitle: "A bright point of balance",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-coral-fold.webp",
    alt: "Broad vermilion and orange folded plane over deep plum with fine grain",
    title: "Coral fold",
    subtitle: "A bold change of direction",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-fuchsia-wave.webp",
    alt: "Broad fuchsia S-shaped band with a coral gradient across deep plum",
    title: "Fuchsia wave",
    subtitle: "One continuous curve",
  },
  {
    src: "https://pro.reactbits.dev/demo-media/abstract-orchid-orbit.webp",
    alt: "Fuchsia ring and peach crescent on a grainy orchid-purple field",
    title: "Orchid orbit",
    subtitle: "Color in orbit",
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const sinc = (x: number) => (Math.abs(x) < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x);

const subscribeToMotion = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

const readMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const parseColor = (value: string) => {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex)) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255);
};

const isLight = (value: string) => {
  const rgb = parseColor(value);
  if (!rgb) return false;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.6;
};

const springTo = (
  value: number,
  velocity: number,
  target: number,
  dt: number,
  response: number,
  ratio: number,
) => {
  const omega = TAU / Math.max(response, 0.02);
  const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / substeps;
  let v = velocity;
  let x = value;
  for (let i = 0; i < substeps; i++) {
    v += (omega * omega * (target - x) - 2 * ratio * omega * v) * h;
    x += v * h;
  }
  return [x, v] as const;
};

const hiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const stageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

const captionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  whiteSpace: "nowrap",
  pointerEvents: "none",
  opacity: 0,
  willChange: "transform, opacity",
};

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  lineHeight: 1.25,
  letterSpacing: "-0.012em",
};

const subtitleStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.4,
  opacity: 0.55,
};

const vertexShader = `
uniform vec4 uBand;

void main() {
  vec2 p = mix(uBand.xy, uBand.zw, position.xy * 0.5 + 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uImages;
uniform float uAspect[${MAX_ITEMS}];
uniform float uFade[${MAX_ITEMS}];
uniform int uCount;
uniform vec2 uView;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uVertical;
uniform float uDist;
uniform float uTilt;
uniform float uK;
uniform float uPitch;
uniform float uAlong;
uniform float uAcross;
uniform float uCardAspect;
uniform float uRadius;
uniform float uPos;
uniform float uMotion;
uniform int uSamples;
uniform float uDim;
uniform float uEdge;
uniform float uIntro;
uniform vec3 uPlaceholder;

float sinc(float x) {
  return abs(x) < 1e-4 ? 1.0 - x * x / 6.0 : sin(x) / x;
}

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 frag = gl_FragCoord.xy / uDpr;
  vec2 sp = frag - uCenter;
  vec2 rp = uVertical > 0.5 ? vec2(-sp.y, sp.x) : sp;
  float edgeDistance = uVertical > 0.5 ? min(frag.y, uView.y - frag.y) : min(frag.x, uView.x - frag.x);
  float edge = uEdge > 0.5 ? smoothstep(0.0, uEdge, edgeDistance) : 1.0;

  float ct = cos(uTilt);
  float st = sin(uTilt);
  vec3 o = vec3(0.0, uDist * st, uDist * ct);
  vec3 forward = -vec3(0.0, st, ct);
  vec3 up = vec3(0.0, ct, -st);
  vec3 d = normalize(forward * uDist + vec3(rp.x, 0.0, 0.0) + up * rp.y);

  float A = uK * (d.x * d.x + d.z * d.z);
  float B = 2.0 * (uK * (o.x * d.x + o.z * d.z) + d.z);
  float C = uK * (o.x * o.x + o.z * o.z) + 2.0 * o.z;
  float disc = B * B - 4.0 * A * C;
  float t;
  if (disc >= 0.0) {
    float q = -0.5 * (B + (B < 0.0 ? -1.0 : 1.0) * sqrt(disc));
    t = C / q;
  } else {
    t = -B / max(2.0 * A, 1e-12);
  }
  vec3 h = o + t * d;
  float s = uK > 1e-7 ? atan(uK * h.x, 1.0 + uK * h.z) / uK : h.x;

  vec2 gs = vec2(dFdx(s), dFdy(s));
  vec2 gy = vec2(dFdx(h.y), dFdy(h.y));
  float gLimit = 0.35 * min(uAlong, uAcross);
  gs = clamp(gs, -gLimit, gLimit);
  gy = clamp(gy, -gLimit, gLimit);
  float pixel = 1.0 / (uDist * uDpr);

  vec2 imgDx;
  vec2 imgDy;
  if (uVertical > 0.5) {
    imgDx = vec2(gy.x / uAcross, -gs.x / uAlong);
    imgDy = vec2(gy.y / uAcross, -gs.y / uAlong);
  } else {
    imgDx = vec2(gs.x / uAlong, gy.x / uAcross);
    imgDy = vec2(gs.y / uAlong, gy.y / uAcross);
  }

  int samples = max(uSamples, 1);
  float travel = abs(uMotion) * uPitch / float(samples);
  if (uVertical > 0.5) {
    imgDy += vec2(0.0, travel / uAlong);
  } else {
    imgDx += vec2(travel / uAlong, 0.0);
  }

  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec2 halfSize = 0.5 * vec2(uAlong, uAcross);
  float radius = min(uRadius, min(halfSize.x, halfSize.y));
  vec4 total = vec4(0.0);

  for (int k = 0; k < ${MAX_SAMPLES}; k++) {
    if (k >= samples) break;
    float tk = samples > 1 ? (float(k) + jitter) / float(samples) - 0.5 : 0.0;
    float sigma = s / uPitch + uPos + uMotion * tk;
    float j = floor(sigma + 0.5);
    float side = sigma - j > 0.0 ? 1.0 : -1.0;
    for (int m = 0; m < 2; m++) {
      float panel = m == 0 ? j : j + side;
      float sc = (panel - uPos - uMotion * tk) * uPitch;
      float a = sc * uK;
      float sa = sin(a);
      float ca = cos(a);
      vec3 n = vec3(sa, 0.0, ca);
      float denom = dot(n, d);
      if (denom > -1e-4) continue;
      float hs = sinc(0.5 * a);
      vec3 P = vec3(sc * sinc(a), 0.0, -sc * 0.5 * a * hs * hs);
      float tt = dot(n, P - o) / denom;
      vec3 hp = o + tt * d;
      float u = dot(hp - P, vec3(ca, 0.0, -sa));
      float v = hp.y;
      vec2 lp = vec2(u, v);
      vec2 qd = abs(lp) - halfSize + radius;
      float sd = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - radius;
      vec2 g = (qd.x > 0.0 || qd.y > 0.0) ? normalize(max(qd, 1e-6)) : (qd.x > qd.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
      float footprint = tt * pixel;
      float footprintU = footprint / max(-denom, 0.12);
      float aa = 0.75 * length(g * vec2(footprintU, footprint));
      aa = max(aa, 0.5 * travel * g.x);
      float coverage = 1.0 - smoothstep(-aa, aa, sd);
      if (coverage <= 0.0) continue;
      int layer = int(mod(panel, float(max(uCount, 1))));
      float imageAspect = uAspect[layer];
      vec2 img = uVertical > 0.5
        ? vec2(v / uAcross, -u / uAlong)
        : vec2(u / uAlong, v / uAcross);
      vec2 crop = uCardAspect > imageAspect
        ? vec2(1.0, imageAspect / uCardAspect)
        : vec2(uCardAspect / imageAspect, 1.0);
      vec2 uv = img * crop + 0.5;
      vec3 color = textureGrad(uImages, vec3(uv.x, 1.0 - uv.y, float(layer)), imgDx * crop * vec2(1.0, -1.0), imgDy * crop * vec2(1.0, -1.0)).rgb;
      color = mix(uPlaceholder, color, uFade[layer]);
      float facing = (1.0 - uDim * smoothstep(0.12, 1.5, abs(a))) * smoothstep(0.03, 0.24, -denom);
      float weight = coverage * facing;
      total += vec4(color * weight, weight);
    }
  }

  total /= float(samples);
  float alpha = clamp(total.a, 0.0, 1.0) * edge * uIntro;
  vec3 rgb = total.a > 1e-5 ? total.rgb / total.a : vec3(0.0);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

const createReel = (
  root: HTMLElement,
  stage: HTMLElement,
  overlay: Overlay,
  settingsRef: { current: Settings },
  itemsRef: { current: VerticalReelItem[] },
  startIndex: number,
  callbacks: Callbacks,
): Controller | null => {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const canvas = doc.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  stage.appendChild(canvas);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const placeholder = new THREE.Color(0.5, 0.5, 0.5);
  const aspects = new Array<number>(MAX_ITEMS).fill(1.6);
  const fades = new Array<number>(MAX_ITEMS).fill(0);

  let layerWidth = 896;
  let layerHeight = 560;
  let layerData = new Uint8Array(layerWidth * layerHeight * 4);
  let images = new THREE.DataArrayTexture(layerData, layerWidth, layerHeight, 1);
  const sampler = doc.createElement("canvas");
  const samplerContext = sampler.getContext("2d", { willReadFrequently: true });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uImages: { value: images },
      uAspect: { value: aspects },
      uFade: { value: fades },
      uCount: { value: 1 },
      uView: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uVertical: { value: 0 },
      uDist: { value: 1200 },
      uTilt: { value: 0 },
      uK: { value: 0.001 },
      uPitch: { value: 480 },
      uAlong: { value: 460 },
      uAcross: { value: 288 },
      uCardAspect: { value: 1.6 },
      uRadius: { value: 12 },
      uPos: { value: 0 },
      uMotion: { value: 0 },
      uSamples: { value: 1 },
      uDim: { value: 0.4 },
      uEdge: { value: 0 },
      uIntro: { value: 0 },
      uPlaceholder: { value: placeholder },
      uBand: { value: new THREE.Vector4(-1, -1, 1, 1) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);

  let layers: Layer[] = [];
  let itemsKey = "";
  let width = 0;
  let height = 0;
  let dpr = 1;
  let sized = false;
  let pos = startIndex;
  let vel = 0;
  let blurVel = 0;
  let lastPos = startIndex;
  let target: number | null = null;
  let targetResponse = 0.7;
  let targetRatio = 0.9;
  let detent: number | null = null;
  let wheelAt = 0;
  let wheeling = false;
  let holdUntil = 0;
  let nextAutoAt = 0;
  let brake = 1;
  let started = false;
  let waitedSince = 0;
  let intro = 0;
  let pointerInside = false;
  let hoverPanel: number | null = null;
  let consumed = false;
  let raf = 0;
  let timer = 0;
  let last = 0;
  let visible = false;
  let destroyed = false;
  let lost = false;
  let reportedActive = Number.NaN;
  let captionIndex = Number.NaN;
  let captionOpacity = -1;
  let captionX = Number.NaN;
  let captionY = Number.NaN;
  let backgroundAt = -10;
  let press: {
    id: number;
    x: number;
    y: number;
    origin: number;
    moved: boolean;
    samples: { t: number; p: number }[];
  } | null = null;

  const geo = {
    along: 460,
    across: 288,
    pitch: 484,
    k: 0.001,
    dist: 1200,
    tilt: 0,
    cx: 0,
    cy: 0,
    vertical: false,
    cardW: 460,
    cardH: 288,
  };

  const count = () => Math.min(Math.max(itemsRef.current.length, 1), MAX_ITEMS);
  const wrap = (index: number) => ((index % count()) + count()) % count();
  const clock = () => performance.now() / 1000;

  let layerCount = 0;
  const ensureTexture = (n: number) => {
    const wanted = clamp(Math.ceil((geo.cardW * Math.min(dpr, 2)) / 64) * 64, 384, 1024);
    const grow = wanted > layerWidth * 1.3;
    if (layerCount === n && !grow) return false;
    const nextWidth = layerCount === 0 || grow ? wanted : layerWidth;
    const nextHeight = Math.round(nextWidth / 1.6);
    layerCount = n;
    layerWidth = nextWidth;
    layerHeight = nextHeight;
    layerData = new Uint8Array(layerWidth * layerHeight * 4 * n);
    images.dispose();
    images = new THREE.DataArrayTexture(layerData, layerWidth, layerHeight, n);
    images.format = THREE.RGBAFormat;
    images.type = THREE.UnsignedByteType;
    images.colorSpace = THREE.NoColorSpace;
    images.minFilter = THREE.LinearMipmapLinearFilter;
    images.magFilter = THREE.LinearFilter;
    images.generateMipmaps = true;
    images.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    images.needsUpdate = true;
    material.uniforms.uImages.value = images;
    layers.forEach((layer) => {
      layer.drawn = false;
    });
    return true;
  };

  const drawLayer = (index: number) => {
    const layer = layers[index];
    if (!layer || !layer.ready || (layer.drawn && !layer.stale) || !samplerContext) return false;
    sampler.width = layerWidth;
    sampler.height = layerHeight;
    try {
      const playing = layer.video && (layer.image as HTMLVideoElement).readyState >= 2;
      const source = layer.video && !playing && layer.poster ? layer.poster : layer.image;
      samplerContext.drawImage(source, 0, 0, layerWidth, layerHeight);
      const pixels = samplerContext.getImageData(0, 0, layerWidth, layerHeight).data;
      layerData.set(pixels, index * layerWidth * layerHeight * 4);
    } catch {
      return false;
    }
    layer.drawn = true;
    layer.stale = false;
    layer.lastDraw = clock();
    images.addLayerUpdate(index);
    images.needsUpdate = true;
    return true;
  };

  const loadImages = () => {
    const items = itemsRef.current.slice(0, MAX_ITEMS);
    const key = items.map((item) => item.src).join("\u0000");
    if (key === itemsKey) return;
    itemsKey = key;
    layers.forEach((layer) => {
      layer.image.onload = null;
    });
    const n = Math.max(items.length, 1);
    const centre = wrap(Math.round(pos));
    layers.forEach((layer) => {
      if (layer.video) (layer.image as HTMLVideoElement).pause();
    });
    layers = items.map((item, index) => {
      const apart = Math.abs(index - centre) % n;
      if (/\.(mp4|webm)(\?|$)/i.test(item.src)) {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        const poster = new Image();
        poster.crossOrigin = "anonymous";
        const layer: Layer = { image: video, video: true, poster, lastDraw: 0, ready: false, drawn: false, aspect: 1.6, fade: 0 };
        poster.onload = () => {
          if (destroyed || layer.ready) return;
          layer.aspect = poster.naturalWidth / Math.max(poster.naturalHeight, 1);
          layer.ready = true;
          schedule();
        };
        poster.src = item.src.replace(/\.(mp4|webm)(\?.*)?$/i, ".jpg");
        video.addEventListener("loadeddata", () => {
          if (destroyed) return;
          layer.stale = true;
          if (!layer.ready) {
            layer.aspect = video.videoWidth / Math.max(video.videoHeight, 1);
            layer.ready = true;
          }
          schedule();
        });
        video.src = item.src;
        void video.play().catch(() => {});
        return layer;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.fetchPriority = Math.min(apart, n - apart) <= 2 ? "high" : "low";
      const layer: Layer = { image, video: false, lastDraw: 0, ready: false, drawn: false, aspect: 1.6, fade: 0 };
      image.onload = () => {
        if (destroyed) return;
        const finish = () => {
          if (destroyed || layer.ready) return;
          layer.aspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
          layer.ready = true;
          schedule();
        };
        image.decode().then(finish, finish);
      };
      image.src = item.src;
      return layer;
    });
    ensureTexture(n);
    fades.fill(0);
  };

  const readSize = () => {
    const settings = settingsRef.current;
    const nextWidth = Math.round(root.clientWidth);
    const nextHeight = Math.round(root.clientHeight);
    if (nextWidth < 2 || nextHeight < 2) {
      sized = false;
      return false;
    }
    const nextDpr = Math.min(view.devicePixelRatio || 1, Math.max(settings.dpr, 0.5));
    if (sized && nextWidth === width && nextHeight === height && nextDpr === dpr) return false;
    sized = true;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    return true;
  };

  const syncColors = () => {
    const value = settingsRef.current.backgroundColor;
    const background = new THREE.Color();
    if (parseColor(value)) {
      background.setStyle(value, THREE.NoColorSpace);
    } else {
      let node: HTMLElement | null = root;
      let found = false;
      while (node && !found) {
        const fill = view.getComputedStyle(node).backgroundColor;
        if (fill && fill !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(fill)) {
          background.setStyle(fill, THREE.NoColorSpace);
          found = true;
        }
        node = node.parentElement;
      }
      if (!found) {
        const ink = new THREE.Color();
        ink.setStyle(view.getComputedStyle(root).color || "#fff", THREE.NoColorSpace);
        background.setHex(ink.r + ink.g + ink.b > 1.5 ? 0x0a0a0a : 0xffffff, THREE.NoColorSpace);
      }
    }
    const light = background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722 > 0.6;
    placeholder.copy(background).lerp(new THREE.Color(light ? 0x000000 : 0xffffff), 0.1);
  };

  const measure = () => {
    const settings = settingsRef.current;
    const vertical = settings.direction === "vertical";
    const aspect = clamp(settings.aspect, 0.4, 3);
    const captionRoom = settings.captions && !vertical ? CAPTION_GAP + CAPTION_HEIGHT : 0;
    let cardH: number;
    if (vertical) {
      cardH = clamp(settings.size, 0.15, 0.9) * height;
      const maxW = width * 0.62;
      if (cardH * aspect > maxW) cardH = maxW / aspect;
    } else {
      cardH = clamp(settings.size, 0.15, 0.9) * Math.max(height - captionRoom, height * 0.5);
      const maxW = width * 0.58;
      if (cardH * aspect > maxW) cardH = maxW / aspect;
    }
    const cardW = cardH * aspect;
    geo.vertical = vertical;
    geo.cardW = cardW;
    geo.cardH = cardH;
    geo.along = vertical ? cardH : cardW;
    geo.across = vertical ? cardW : cardH;
    geo.pitch = geo.along + Math.max(settings.gap, 0);
    geo.k = (clamp(settings.curvature, 0, 1) * 0.78) / geo.pitch;
    geo.dist = clamp(settings.distance, 1.2, 12) * geo.along;
    geo.tilt = (clamp(settings.tilt, -25, 25) * Math.PI) / 180;
    const captionShift = settings.captions && vertical && width >= 560 ? Math.min(width * 0.12, 150) : 0;
    geo.cx = width / 2 - captionShift;
    geo.cy = height / 2 + captionRoom / 2;
  };

  const project = (x: number, y: number, z: number) => {
    const ct = Math.cos(geo.tilt);
    const st = Math.sin(geo.tilt);
    const ox = 0;
    const oy = geo.dist * st;
    const oz = geo.dist * ct;
    const rx = x - ox;
    const ry = y - oy;
    const rz = z - oz;
    const fz = -(ry * st + rz * ct);
    const ux = ry * ct - rz * st;
    if (fz < 1) return null;
    const scale = geo.dist / fz;
    const ringX = rx * scale;
    const ringY = ux * scale;
    const sx = geo.vertical ? ringY : ringX;
    const sy = geo.vertical ? -ringX : ringY;
    return { x: geo.cx + sx, y: height - (geo.cy + sy) };
  };

  const panelPoint = (sc: number, u: number, v: number) => {
    const a = sc * geo.k;
    const half = sinc(0.5 * a);
    const px = sc * sinc(a) + u * Math.cos(a);
    const pz = -sc * 0.5 * a * half * half - u * Math.sin(a);
    return project(px, v, pz);
  };

  const rayHit = (clientX: number, clientY: number) => {
    const rect = root.getBoundingClientRect();
    const fx = clientX - rect.left;
    const fy = height - (clientY - rect.top);
    const sx = fx - geo.cx;
    const sy = fy - geo.cy;
    const rx = geo.vertical ? -sy : sx;
    const ry = geo.vertical ? sx : sy;
    const ct = Math.cos(geo.tilt);
    const st = Math.sin(geo.tilt);
    const o = [0, geo.dist * st, geo.dist * ct];
    const dRaw = [rx, -st * geo.dist + ct * ry, -ct * geo.dist - st * ry];
    const len = Math.hypot(dRaw[0], dRaw[1], dRaw[2]);
    const d = [dRaw[0] / len, dRaw[1] / len, dRaw[2] / len];
    const k = geo.k;
    const A = k * (d[0] * d[0] + d[2] * d[2]);
    const B = 2 * (k * (o[0] * d[0] + o[2] * d[2]) + d[2]);
    const C = k * (o[0] * o[0] + o[2] * o[2]) + 2 * o[2];
    const disc = B * B - 4 * A * C;
    const t = disc >= 0 ? C / (-0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(disc))) : -B / Math.max(2 * A, 1e-12);
    const hx = o[0] + t * d[0];
    const hz = o[2] + t * d[2];
    const s = k > 1e-7 ? Math.atan2(k * hx, 1 + k * hz) / k : hx;
    const sigma = s / geo.pitch + pos;
    const j = Math.round(sigma);
    for (const panel of [j, j + (sigma - j > 0 ? 1 : -1)]) {
      const sc = (panel - pos) * geo.pitch;
      const a = sc * k;
      const n = [Math.sin(a), 0, Math.cos(a)];
      const denom = n[0] * d[0] + n[2] * d[2];
      if (denom > -1e-4) continue;
      const half = sinc(0.5 * a);
      const P = [sc * sinc(a), 0, -sc * 0.5 * a * half * half];
      const tt = (n[0] * (P[0] - o[0]) + n[1] * (P[1] - o[1]) + n[2] * (P[2] - o[2])) / denom;
      const hp = [o[0] + tt * d[0], o[1] + tt * d[1], o[2] + tt * d[2]];
      const u = (hp[0] - P[0]) * Math.cos(a) - (hp[2] - P[2]) * Math.sin(a);
      const v = hp[1];
      if (Math.abs(u) <= geo.along / 2 && Math.abs(v) <= geo.across / 2) return panel;
    }
    return null;
  };

  const schedule = () => {
    if (destroyed || lost || !visible || raf) return;
    if (timer) {
      view.clearTimeout(timer);
      timer = 0;
    }
    raf = requestAnimationFrame(frame);
  };

  const hold = (seconds = 2.6) => {
    const at = clock();
    holdUntil = Math.max(holdUntil, at + seconds);
    nextAutoAt = Math.max(nextAutoAt, at + Math.max(settingsRef.current.interval, seconds));
  };

  const aim = (value: number, response: number, ratio: number) => {
    target = value;
    targetResponse = response;
    targetRatio = ratio;
    detent = null;
    schedule();
  };

  const step = (direction: number) => {
    aim(Math.round(target ?? pos) + direction, 0.62, 0.9);
    hold();
  };

  const goTo = (index: number) => {
    const n = count();
    const base = Math.round(target ?? pos);
    const offset = ((((index - wrap(base)) % n) + n + Math.floor(n / 2)) % n) - Math.floor(n / 2);
    aim(base + offset, 0.75 + Math.min(Math.abs(offset), 6) * 0.06, 0.9);
    hold();
  };

  const spin = (cards: number) => {
    const turns = Math.round(cards);
    if (!turns) return;
    aim(Math.round(target ?? pos) + turns, 1.1 + Math.min(Math.abs(turns), 12) * 0.08, 0.92);
    hold();
  };

  function frame(time: number) {
    raf = 0;
    if (destroyed || lost) return;
    if (!sized) {
      readSize();
      if (!sized) return;
    }
    const settings = settingsRef.current;
    const dt = last && time - last < 100 ? Math.min(Math.max((time - last) / 1000, 0), 0.05) : 1 / 60;
    last = time;
    const now = clock();
    const reduced = settings.reduced;
    const n = count();
    let busy = false;

    if (now - backgroundAt > 1.2) {
      backgroundAt = now;
      syncColors();
    }
    readSize();
    measure();
    if (ensureTexture(Math.max(layers.length, 1))) busy = true;

    let drew = false;
    const centre = wrap(Math.round(pos));
    // Keep video cards near the centre animating at about 15 frames a second.
    const nowSec = clock();
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.video || !layer.ready || !layer.drawn) continue;
      const apart = Math.min(Math.abs(i - centre), n - Math.abs(i - centre));
      if (apart <= 1 && nowSec - layer.lastDraw > 1 / 15) layer.stale = true;
    }
    if (layers.some((layer) => layer.video)) busy = true;
    const order = layers
      .map((layer, index) => ({ index, distance: Math.min(Math.abs(index - centre), n - Math.abs(index - centre)) }))
      // Cards that have never been drawn go first, so redrawing playing videos can't starve them.
      .sort((a, b) => (layers[a.index].lastDraw === 0 ? -1 : 0) - (layers[b.index].lastDraw === 0 ? -1 : 0) || a.distance - b.distance);
    for (const entry of order) {
      const layer = layers[entry.index];
      if (layer.ready && (!layer.drawn || layer.stale)) {
        drew = drawLayer(entry.index);
        if (drew) break;
      }
    }
    if (drew) busy = true;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      aspects[i] = layer.aspect;
      if (layer.drawn && layer.fade < 1) {
        layer.fade = reduced || !started ? 1 : Math.min(1, layer.fade + dt / 0.45);
        busy = true;
      }
      fades[i] = layer.drawn ? layer.fade : 0;
    }

    if (!started) {
      if (!waitedSince) waitedSince = now;
      let ready = true;
      for (let offset = -2; offset <= 2; offset++) {
        const layer = layers[wrap(Math.round(pos) + offset)];
        if (layer && !layer.drawn) ready = false;
      }
      if (ready || reduced || now - waitedSince > 1.8) {
        started = true;
        if (!reduced) {
          pos = startIndex - 2.6;
          lastPos = pos;
          aim(startIndex, 1.5, 0.94);
        }
        nextAutoAt = now + Math.max(settings.interval, 1) + 1.2;
      } else {
        busy = true;
      }
    }
    if (started && intro < 1) {
      intro = reduced ? 1 : Math.min(1, intro + dt / 0.6);
      busy = true;
    }

    const autoplay = settings.autoplay;
    const stopped = settings.paused || settings.held || reduced || autoplay === "off";
    const touching = !!press || (settings.pauseOnHover && pointerInside);
    const holding = touching || now < holdUntil;
    const brakeTarget = stopped || holding || autoplay !== "drift" ? 0 : 1;
    brake += (brakeTarget - brake) * (1 - Math.exp(-dt / (brakeTarget > brake ? 0.9 : 0.3)));
    if (Math.abs(brakeTarget - brake) > 1e-3) busy = true;
    else brake = brakeTarget;

    if ((autoplay === "step" || autoplay === "spin") && !stopped && started && n > 1) {
      if (touching) nextAutoAt = Math.max(nextAutoAt, now + Math.max(settings.interval, 1) * 0.6);
      else if (!holding && now >= nextAutoAt && target === null && detent === null && Math.abs(vel) < 0.05) {
        nextAutoAt = now + Math.max(settings.interval, 1);
        const direction = settings.speed < 0 ? -1 : 1;
        if (autoplay === "step") aim(Math.round(pos) + direction, 0.9, 0.96);
        else aim(Math.round(pos) + direction * (3 + Math.floor(Math.random() * 4)), 1.5, 0.94);
      }
    }

    if (wheeling && now - wheelAt > 0.14) {
      wheeling = false;
      if (settings.snap && target !== null) target = Math.round(target);
    }

    const tau = 0.35 + 1.45 * (1 - clamp(settings.friction, 0, 1));
    if (press && press.moved) {
      busy = true;
    } else if (target !== null) {
      [pos, vel] = springTo(pos, vel, target, dt, reduced ? 0.08 : targetResponse, targetRatio);
      if (Math.abs(pos - target) < 2e-4 && Math.abs(vel) < 2e-3) {
        pos = target;
        vel = 0;
        target = null;
      } else {
        busy = true;
      }
    } else if (detent !== null) {
      [pos, vel] = springTo(pos, vel, detent, dt, reduced ? 0.08 : 0.46, 0.62);
      if (Math.abs(pos - detent) < 2e-4 && Math.abs(vel) < 2e-3) {
        pos = detent;
        vel = 0;
        detent = null;
      } else {
        busy = true;
      }
    } else {
      const drift = autoplay === "drift" ? settings.speed * brake : 0;
      const free = vel - drift;
      const decay = Math.exp(-dt / tau);
      const coulomb = Math.min(Math.abs(free * decay), 0.6 * dt) * Math.sign(free);
      vel = drift + free * decay - coulomb;
      pos += vel * dt;
      if (Math.abs(vel - drift) > 1e-3) busy = true;
      if (settings.snap && Math.abs(vel - drift) < 2.2 && Math.abs(drift) < 1e-3 && Math.abs(vel) > 1e-3) {
        detent = vel > 0 ? Math.ceil(pos - 0.08) : Math.floor(pos + 0.08);
        if (Math.abs(detent - pos) > 0.92) detent = Math.round(pos);
        busy = true;
      } else if (settings.snap && Math.abs(drift) < 1e-3 && Math.abs(vel) <= 1e-3 && Math.abs(pos - Math.round(pos)) > 1e-3) {
        detent = Math.round(pos);
        busy = true;
      }
      if (Math.abs(drift) > 1e-4) busy = true;
    }

    const frameVel = dt > 0 ? (pos - lastPos) / dt : 0;
    lastPos = pos;
    blurVel += (frameVel - blurVel) * (1 - Math.exp(-dt / 0.035));
    if (Math.abs(blurVel) < 1e-3) blurVel = 0;
    else busy = true;

    const active = wrap(Math.round(pos));
    if (active !== reportedActive) {
      reportedActive = active;
      callbacks.onActive(active);
    }

    const u = material.uniforms;
    const exposure = reduced ? 0 : (clamp(settings.motionBlur, 0, 3) / 30);
    const motion = clamp(blurVel * exposure, -2.5, 2.5);
    const travelPx = Math.abs(motion) * geo.pitch * dpr;
    u.uSamples.value = clamp(Math.ceil(travelPx / 4), 1, MAX_SAMPLES);
    u.uMotion.value = motion;
    u.uPos.value = pos;
    u.uCount.value = Math.max(layers.length, 1);
    u.uView.value.set(width, height);
    u.uDpr.value = dpr;
    u.uCenter.value.set(geo.cx, geo.cy);
    u.uVertical.value = geo.vertical ? 1 : 0;
    u.uDist.value = geo.dist;
    u.uTilt.value = geo.tilt;
    u.uK.value = geo.k;
    u.uPitch.value = geo.pitch;
    u.uAlong.value = geo.along;
    u.uAcross.value = geo.across;
    u.uCardAspect.value = geo.cardW / geo.cardH;
    u.uRadius.value = Math.max(settings.radius, 0);
    u.uDim.value = clamp(settings.dim, 0, 1);
    u.uEdge.value = clamp(settings.edgeFade, 0, 1) * (geo.vertical ? height : width) * 0.22;
    u.uIntro.value = smooth(0, 1, intro);

    let lo = Infinity;
    let hi = -Infinity;
    for (let offset = -4; offset <= 4; offset++) {
      const sc = (Math.round(pos) + offset - pos) * geo.pitch;
      for (const uu of [-geo.along / 2, geo.along / 2]) {
        for (const vv of [-geo.across / 2, geo.across / 2]) {
          const point = panelPoint(sc, uu, vv);
          if (!point) continue;
          const across = geo.vertical ? point.x : height - point.y;
          lo = Math.min(lo, across);
          hi = Math.max(hi, across);
        }
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = geo.vertical ? width : height;
    }
    lo -= 6;
    hi += 6;
    if (geo.vertical) {
      u.uBand.value.set((lo / width) * 2 - 1, -1, (hi / width) * 2 - 1, 1);
    } else {
      u.uBand.value.set(-1, (lo / height) * 2 - 1, 1, (hi / height) * 2 - 1);
    }

    paintCaption(reduced);
    renderer.render(scene, camera);

    if (busy || press || (autoplay === "drift" && brake > 0.001)) schedule();
    else if ((autoplay === "step" || autoplay === "spin") && !stopped && !touching && n > 1 && !timer) {
      timer = view.setTimeout(() => {
        timer = 0;
        last = 0;
        schedule();
      }, Math.max(Math.max(nextAutoAt, holdUntil) - now, 0.02) * 1000 + 16);
    } else if (autoplay === "drift" && !stopped && !touching && now < holdUntil && !timer) {
      timer = view.setTimeout(() => {
        timer = 0;
        last = 0;
        schedule();
      }, (holdUntil - now) * 1000 + 16);
    }
  }

  function paintCaption(reduced: boolean) {
    const settings = settingsRef.current;
    const show = settings.captions && (!geo.vertical || width >= 560);
    if (!show) {
      if (captionOpacity !== 0) {
        captionOpacity = 0;
        overlay.caption.style.opacity = "0";
      }
      return;
    }
    const nearest = Math.round(pos);
    if (nearest !== captionIndex) {
      captionIndex = nearest;
      const item = itemsRef.current[wrap(nearest)];
      overlay.title.textContent = item ? item.title ?? item.alt : "";
      overlay.subtitle.textContent = item?.subtitle ?? "";
      overlay.subtitle.style.display = item?.subtitle ? "" : "none";
    }
    const frac = Math.abs(pos - nearest);
    const opacity =
      (1 - smooth(0.06, 0.32, frac)) * (1 - smooth(1.2, 3.5, Math.abs(blurVel))) * (reduced ? 1 : smooth(0.4, 1, intro));
    let x: number;
    let y: number;
    if (geo.vertical) {
      const edge = panelPoint(0, 0, geo.across / 2);
      x = edge ? edge.x + 28 : geo.cx + geo.across / 2 + 28;
      y = height / 2 - 22;
      overlay.caption.style.alignItems = "flex-start";
      overlay.caption.style.textAlign = "left";
    } else {
      const bottom = panelPoint(0, 0, -geo.across / 2);
      x = geo.cx;
      y = (bottom ? bottom.y : height / 2 + geo.across / 2) + CAPTION_GAP;
      overlay.caption.style.alignItems = "center";
      overlay.caption.style.textAlign = "center";
    }
    const transform = geo.vertical
      ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
      : `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) translateX(-50%)`;
    if (Number.isNaN(captionX) || Math.abs(x - captionX) > 0.05 || Math.abs(y - captionY) > 0.05) {
      captionX = x;
      captionY = y;
      overlay.caption.style.transform = transform;
    }
    if (Math.abs(opacity - captionOpacity) > 0.002) {
      captionOpacity = opacity;
      overlay.caption.style.opacity = opacity.toFixed(3);
    }
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch") {
      pointerInside = true;
      if (!press) {
        hoverPanel = rayHit(event.clientX, event.clientY);
        const cursor = hoverPanel !== null ? "pointer" : settingsRef.current.draggable ? "grab" : "";
        if (root.style.cursor !== cursor) root.style.cursor = cursor;
      }
    }
    if (press && press.id === event.pointerId) {
      const settings = settingsRef.current;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.moved && Math.hypot(dx, dy) > 6) {
        press.moved = true;
        target = null;
        detent = null;
        vel = 0;
        root.style.cursor = "grabbing";
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {}
      }
      if (press.moved && settings.draggable) {
        const along = geo.vertical ? dy : dx;
        pos = press.origin - along / Math.max(geo.pitch, 1);
        const t = performance.now();
        press.samples.push({ t, p: pos });
        while (press.samples.length > 2 && t - press.samples[0].t > 110) press.samples.shift();
      }
    }
    schedule();
  };

  const onDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button > 0) return;
    consumed = false;
    const settings = settingsRef.current;
    if (Math.abs(vel) > 2.5 && !settings.reduced) {
      const ahead = vel > 0 ? Math.ceil(pos + vel * 0.06) : Math.floor(pos + vel * 0.06);
      aim(ahead, 0.34, 0.8);
      consumed = true;
      hold();
      return;
    }
    if (!settings.draggable) return;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: pos,
      moved: false,
      samples: [{ t: performance.now(), p: pos }],
    };
    hold();
    schedule();
  };

  const finish = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    const ended = press;
    press = null;
    try {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    } catch {}
    if (ended.moved) {
      consumed = true;
      const t = performance.now();
      const recent = ended.samples.filter((sample) => t - sample.t < 110);
      let velocity = 0;
      if (recent.length > 1 && t - recent[recent.length - 1].t < 60) {
        const span = Math.max((recent[recent.length - 1].t - recent[0].t) / 1000, 1 / 120);
        velocity = (recent[recent.length - 1].p - recent[0].p) / span;
      }
      const settings = settingsRef.current;
      vel = settings.reduced ? 0 : clamp(velocity, -32, 32);
      target = null;
      detent = null;
      if (settings.reduced && settings.snap) aim(Math.round(pos), 0.08, 1);
      root.style.cursor = settings.draggable ? "grab" : "";
      hold();
    }
    schedule();
  };

  const onClick = (event: MouseEvent) => {
    if (consumed) {
      consumed = false;
      return;
    }
    const panel = rayHit(event.clientX, event.clientY);
    if (panel === null) return;
    const current = Math.round(target ?? pos);
    if (panel === current && Math.abs(pos - current) < 0.2) {
      callbacks.onSelect(wrap(panel));
    } else {
      aim(panel, 0.7 + Math.min(Math.abs(panel - pos), 5) * 0.05, 0.9);
      hold();
    }
  };

  const onLeave = (event: PointerEvent) => {
    if (press && press.id === event.pointerId) return;
    pointerInside = false;
    hoverPanel = null;
    root.style.cursor = "";
    hold(0.8);
    schedule();
  };

  const onWheel = (event: WheelEvent) => {
    if (!settingsRef.current.wheel) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const delta = clamp(
      (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit,
      -240,
      240,
    );
    const base = wheeling && target !== null ? target : Math.round(target ?? pos);
    aim(base + delta / 100, 0.5, 0.9);
    wheeling = true;
    wheelAt = clock();
    hold();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.target !== root) return;
    const vertical = geo.vertical;
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : "ArrowLeft";
    if (event.key === forward) {
      event.preventDefault();
      step(1);
    } else if (event.key === backward) {
      event.preventDefault();
      step(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      spin(5);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      spin(-5);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(count() - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      callbacks.onSelect(wrap(Math.round(target ?? pos)));
    }
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("click", onClick);
  stage.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("keydown", onKey);

  const resizer = new ResizeObserver(() => {
    if (readSize()) schedule();
  });
  resizer.observe(root);

  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          ([entry]) => {
            visible = entry.isIntersecting;
            if (visible) {
              last = 0;
              schedule();
            } else {
              if (raf) cancelAnimationFrame(raf);
              raf = 0;
              if (timer) view.clearTimeout(timer);
              timer = 0;
            }
          },
          { rootMargin: "80px" },
        );
  if (observer) observer.observe(root);
  else visible = true;

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onRestored = () => {
    lost = false;
    itemsKey = "";
    loadImages();
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  readSize();
  if (sized) measure();
  syncColors();
  loadImages();
  renderer.compile(scene, camera);
  schedule();

  return {
    sync: () => {
      readSize();
      syncColors();
      loadImages();
      captionIndex = Number.NaN;
      schedule();
    },
    step,
    goTo,
    spin,
    destroy: () => {
      destroyed = true;
      layers.forEach((layer) => {
        if (layer.video) {
          const video = layer.image as HTMLVideoElement;
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      });
      if (raf) cancelAnimationFrame(raf);
      if (timer) view.clearTimeout(timer);
      observer?.disconnect();
      resizer.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", finish);
      stage.removeEventListener("pointercancel", finish);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("click", onClick);
      stage.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
      root.style.cursor = "";
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      layers.forEach((layer) => {
        layer.image.onload = null;
      });
      images.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      canvas.remove();
    },
  };
};

export const VerticalReel = forwardRef<VerticalReelHandle, VerticalReelProps>(function VerticalReel(
  {
    items = defaultItems,
    startIndex = 0,
    direction = "horizontal",
    aspect = 1.6,
    size = 0.42,
    curvature = 0.6,
    distance = 3,
    tilt = 6,
    gap = 22,
    radius = 14,
    dim = 0.45,
    edgeFade = 0.5,
    motionBlur = 0.6,
    friction = 0.5,
    snap = true,
    autoplay = "step",
    speed = 0.25,
    interval = 3.5,
    pauseOnHover = true,
    draggable = true,
    wheel = true,
    captions = true,
    backgroundColor = "transparent",
    paused = false,
    dpr = 2,
    ariaLabel = "Image reel. Drag or flick to spin it, scroll or use the arrow keys to move between images.",
    onIndexChange,
    onSelect,
    className,
    style,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLSpanElement>(null);
  const controllerRef = useRef<Controller | null>(null);
  const reduced = useSyncExternalStore(subscribeToMotion, readMotion, () => false);
  const list = items.length ? items : defaultItems;
  const itemsRef = useRef(list);
  const [initialIndex] = useState(() => clamp(Math.round(startIndex), 0, Math.max(list.length - 1, 0)));
  const [active, setActive] = useState(initialIndex);
  const [held, setHeld] = useState(false);
  const [failed, setFailed] = useState(false);

  const settings: Settings = {
    direction,
    aspect,
    size,
    curvature,
    distance,
    tilt,
    gap,
    radius,
    dim,
    edgeFade,
    motionBlur,
    friction,
    snap,
    autoplay,
    speed,
    interval,
    pauseOnHover,
    draggable,
    wheel,
    captions,
    backgroundColor,
    paused,
    dpr,
    reduced,
    held,
  };
  const settingsRef = useRef(settings);
  const callbacksRef = useRef({ onIndexChange, onSelect });

  useEffect(() => {
    settingsRef.current = settings;
    itemsRef.current = list;
    callbacksRef.current = { onIndexChange, onSelect };
    controllerRef.current?.sync();
  });

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const caption = captionRef.current;
    const title = titleRef.current;
    const subtitle = subtitleRef.current;
    if (!root || !stage || !caption || !title || !subtitle) return;
    const controller = createReel(root, stage, { caption, title, subtitle }, settingsRef, itemsRef, initialIndex, {
      onActive: (index) => {
        setActive(index);
        callbacksRef.current.onIndexChange?.(index);
      },
      onSelect: (index) => {
        const item = itemsRef.current[index];
        if (!item) return;
        callbacksRef.current.onSelect?.(item, index);
        if (item.href) window.location.assign(item.href);
      },
    });
    if (!controller) {
      const frame = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(frame);
    }
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [initialIndex]);

  useImperativeHandle(
    ref,
    () => ({
      next: () => controllerRef.current?.step(1),
      previous: () => controllerRef.current?.step(-1),
      goTo: (index: number) => controllerRef.current?.goTo(index),
      spin: (cards: number) => controllerRef.current?.spin(cards),
    }),
    [],
  );

  const backgroundValue = backgroundColor.trim().toLowerCase();
  const transparent = backgroundValue === "transparent" || backgroundValue === "";
  const light = !transparent && isLight(backgroundValue);
  const ink = transparent ? "currentColor" : light ? "#0a0a0a" : "#fafafa";
  const current = list[active] ?? list[0];

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-full min-h-[420px] w-full overflow-hidden outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color-mix(in_oklch,currentColor_35%,transparent)]",
        className,
      )}
      style={{ backgroundColor: transparent ? undefined : backgroundColor, color: ink, ...style }}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === " " && event.target === event.currentTarget) {
          event.preventDefault();
          setHeld((value) => !value);
        }
      }}
    >
      <div ref={stageRef} style={{ ...stageStyle, touchAction: direction === "vertical" ? "pan-x" : "pan-y" }} />
      {failed && current ? (
        <div style={{ position: "absolute", inset: "18%", display: "grid", placeItems: "center" }}>
          <img
            src={current.src}
            alt={current.alt}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover", borderRadius: radius }}
          />
        </div>
      ) : null}
      <ul style={hiddenStyle}>
        {list.map((item, index) => (
          <li key={`${item.src}-${index}`} aria-current={index === active ? "true" : undefined}>
            {item.title ? `${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}` : item.alt}
          </li>
        ))}
      </ul>
      <div aria-live="polite" style={hiddenStyle}>
        {current ? current.title ?? current.alt : ""}
      </div>
      <div ref={captionRef} aria-hidden="true" style={captionStyle}>
        <span ref={titleRef} style={titleStyle} />
        <span ref={subtitleRef} style={subtitleStyle} />
      </div>
    </div>
  );
});

VerticalReel.displayName = "VerticalReel";

export default VerticalReel;
