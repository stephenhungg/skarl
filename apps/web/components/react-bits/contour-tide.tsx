"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cn } from "@/lib/utils";

export interface ContourTideProps {
  colors?: string[];
  backgroundColor?: string;
  density?: number;
  particleSize?: number;
  waveHeight?: number;
  choppiness?: number;
  wavelength?: number;
  windAngle?: number;
  horizon?: number;
  fog?: number;
  glow?: number;
  /** 0 is open water; 1 breaks the surface into square blocks riding the swell, with pulses running between them. */
  blocks?: number;
  foam?: number;
  speed?: number;
  interactive?: boolean;
  parallax?: number;
  swell?: number;
  swellRadius?: number;
  clickRipples?: boolean;
  seed?: number;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const WAVES = 14;
const MAX_RIPPLES = 4;
const FOV = 50;
const CAMERA_HEIGHT = 1.35;
const FAR = 36;
const BASE_COLUMNS = 1000;
const BASE_ROWS = 380;
const DEFAULT_COLORS = ["#6E6E80", "#FFFFFF"];

const surfaceChunk = `
#define WAVES ${WAVES}
#define MAX_RIPPLES ${MAX_RIPPLES}

uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uSpread;
uniform float uSpreadBase;
uniform vec4 uWave[WAVES];
uniform vec4 uWaveMotion[WAVES];
uniform float uHeight;
uniform vec4 uCursor;
uniform float uCursorRadius;
uniform vec4 uRipple[MAX_RIPPLES];

float gridDepth(float v) {
  float inverse = 1.0 / uFar + (1.0 / uNear - 1.0 / uFar) * pow(clamp(1.0 - v, 0.0, 1.0), 1.8);
  return 1.0 / inverse;
}

vec3 surfacePoint(vec2 ground, out vec3 normal, out float fold, out float swell) {
  vec3 offset = vec3(0.0);
  normal = vec3(0.0, 1.0, 0.0);
  fold = 1.0;
  float calm = mix(0.3, 1.0, smoothstep(uNear * 0.9, uNear * 4.0, -ground.y));
  for (int i = 0; i < WAVES; i++) {
    vec4 wave = uWave[i];
    vec4 motion = uWaveMotion[i];
    float phase = wave.z * dot(wave.xy, ground) - motion.x * uTime + motion.y;
    float s = sin(phase);
    float c = cos(phase);
    float amplitude = wave.w * uHeight * calm;
    float steep = motion.z;
    offset.x += steep * amplitude * wave.x * c;
    offset.z += steep * amplitude * wave.y * c;
    offset.y += amplitude * s;
    float ka = wave.z * amplitude;
    normal.x -= wave.x * ka * c;
    normal.z -= wave.y * ka * c;
    normal.y -= steep * ka * s;
    fold -= steep * ka * s;
  }

  vec2 toCursor = ground - uCursor.xy;
  float radius2 = max(uCursorRadius * uCursorRadius, 1e-4);
  swell = uCursor.z * exp(-dot(toCursor, toCursor) / radius2);
  offset.y += swell;
  normal.x += swell * 2.0 * toCursor.x / radius2;
  normal.z += swell * 2.0 * toCursor.y / radius2;

  for (int k = 0; k < MAX_RIPPLES; k++) {
    vec4 ripple = uRipple[k];
    if (ripple.w <= 0.001) continue;
    vec2 away = ground - ripple.xy;
    float r = max(length(away), 1e-4);
    float band = r - ripple.z;
    float envelope = exp(-band * band * 3.0) * ripple.w * 0.26;
    offset.y += sin(band * 9.0) * envelope;
    float slope = (9.0 * cos(band * 9.0) - 6.0 * band * sin(band * 9.0)) * envelope;
    normal.x -= slope * away.x / r;
    normal.z -= slope * away.y / r;
  }

  return vec3(ground.x + offset.x, offset.y, ground.y + offset.z);
}
`;

const depthVertexShader = `
${surfaceChunk}

attribute vec2 aGrid;

void main() {
  float depth = gridDepth(aGrid.y);
  float halfWidth = uSpreadBase + depth * uSpread;
  vec2 ground = vec2(aGrid.x * halfWidth * 1.03, -depth);
  vec3 normal;
  float fold;
  float swell;
  vec3 world = surfacePoint(ground, normal, fold, swell);
  world.y -= 0.035 + depth * 0.004;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const depthFragmentShader = `
void main() {
  gl_FragColor = vec4(0.0);
}
`;

const vertexShader = `
${surfaceChunk}

attribute vec2 aGrid;
attribute vec2 aJitter;

uniform float uRows;
uniform float uColumns;
uniform vec3 uSun;
uniform float uFogDistance;
uniform float uFoam;
uniform float uSize;
uniform float uFocal;
uniform float uPixelRatio;
uniform float uGlow;
uniform float uBlocks;

varying float vBright;
varying float vTone;

const float BLOCK = 0.32;
const float GAP = 0.12;

float blockHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  float depth = gridDepth(aGrid.y + aJitter.y / uRows);
  float halfWidth = uSpreadBase + depth * uSpread;
  vec2 ground = vec2((aGrid.x + aJitter.x / uColumns) * halfWidth, -depth);
  float side = 1.0 - smoothstep(0.9, 1.0, abs(aGrid.x));
  vec3 normal;
  float fold;
  float swell;
  vec3 world = surfacePoint(ground, normal, fold, swell);

  // Blocks: every particle in a square cell rides the swell at its cell centre, so the surface reads as
  // flat tiles. Particles in the thin gaps between tiles stay dim, and some gap rows carry a travelling pulse.
  vec2 cellId = floor(ground / BLOCK);
  vec2 local = fract(ground / BLOCK);
  float inGap = 1.0 - step(GAP, local.x) * step(local.x, 1.0 - GAP) * step(GAP, local.y) * step(local.y, 1.0 - GAP);
  float pulse = 0.0;
  if (uBlocks > 0.0) {
    vec2 centre = (cellId + 0.5) * BLOCK;
    vec3 cn; float cf; float cs;
    vec3 cw = surfacePoint(centre, cn, cf, cs);
    vec3 tiled = cw + vec3(ground.x - centre.x, 0.0, ground.y - centre.y);
    world = mix(world, tiled, uBlocks);
    normal = normalize(mix(normal, cn, uBlocks));
    fold = mix(fold, cf, uBlocks);
    float rowHash = blockHash(cellId.y);
    float onRow = step(0.72, rowHash) * step(local.y, GAP);
    float front = mod(uTime * (1.4 + rowHash * 1.2) + rowHash * 37.0, 24.0) - 12.0;
    float behind = front - ground.x;
    pulse = onRow * (exp(-behind * behind * 40.0) * 1.0 + step(0.0, behind) * exp(-behind * 2.2) * 0.45) * uBlocks;
  }
  vec3 offset = vec3(world.x - ground.x, world.y, world.z - ground.y);
  vec4 view = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;

  vec3 n = normalize(normal);
  vec3 toEye = normalize(cameraPosition - world);
  float lit = max(dot(n, uSun), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, toEye), 0.0), 5.0);
  float glint = pow(max(dot(reflect(-uSun, n), toEye), 0.0), 40.0) * (0.04 + 3.6 * fresnel);
  float crest = smoothstep(0.25, 1.0, offset.y / max(uHeight * 0.5, 0.01));
  float froth = smoothstep(0.7, 0.2, fold) * uFoam;
  float near = smoothstep(uNear * 0.95, uNear * 1.2, depth) * side;
  float distant = smoothstep(uNear * 1.1, uNear * 5.0, depth);
  float far = exp(-depth / max(uFogDistance, 0.5)) * smoothstep(uFar, uFar * 0.9, depth);

  float edgeOn = clamp(abs(dot(n, toEye)) / 0.35, 0.06, 1.0);
  float pileUp = mix(edgeOn, 1.0, smoothstep(uNear * 3.0, uNear * 14.0, depth));
  float brightness = (0.24 + 0.05 * lit + 0.9 * fresnel * distant + (glint * 2.6 + 2.4 * crest * crest * crest + froth * 2.6) * mix(0.3, 1.0, distant)) * pileUp * near * far;
  brightness *= mix(1.0, mix(1.0, 0.18, inGap), uBlocks);
  brightness += pulse * 3.2 * near * far;
  vTone = clamp(glint * 0.9 + crest * 0.6 + froth + pulse * 2.0, 0.0, 1.0);

  float pixels = uSize * uFocal / max(-view.z, 0.05) * (1.0 + crest * 0.35) * uPixelRatio;
  float coverage = min(pixels, 1.0);
  vBright = brightness * coverage;
  gl_PointSize = clamp(pixels, 1.0, 6.0 * uPixelRatio) * (1.0 + uGlow * 1.6);
}
`;

const fragmentShader = `
precision highp float;

uniform vec3 uTrough;
uniform vec3 uCrest;
uniform float uGlow;
uniform float uInk;
uniform float uIntensity;

varying float vBright;
varying float vTone;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float edge = 1.0 / (1.0 + uGlow * 1.6);
  float core = 1.0 - smoothstep(edge * 0.45, edge, r);
  float halo = exp(-r * r * 7.0) * uGlow * 0.28;
  float amount = (core + halo) * vBright * uIntensity;
  if (amount < 0.002) discard;
  vec3 color = mix(uTrough, uCrest, vTone);
  if (uInk > 0.5) {
    float alpha = clamp(amount * 1.6, 0.0, 1.0);
    gl_FragColor = vec4(color * alpha, alpha);
  } else {
    float alpha = clamp(amount, 0.0, 1.0);
    gl_FragColor = vec4(color * amount, alpha);
  }
}
`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const isTransparent = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") return true;
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized.endsWith("00");
  if (/^#[0-9a-f]{4}$/.test(normalized)) return normalized.endsWith("0");
  const alpha = normalized.match(
    /^(?:rgba?|hsla?)\(.*[,/]\s*(0|0?\.0+|0%)\s*\)$/,
  );
  return alpha !== null;
};

const scratch = new THREE.Color();

const readSrgb = (target: THREE.Vector3, value: string, fallback: string) => {
  const trimmed = value.trim();
  try {
    scratch.set(/^#[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(0, 7) : trimmed);
  } catch {
    scratch.set(fallback);
  }
  const rgb = { r: 0, g: 0, b: 0 };
  scratch.getRGB(rgb, THREE.SRGBColorSpace);
  return target.set(rgb.r, rgb.g, rgb.b);
};

const random = (seed: number) => {
  let state = (Math.floor(seed * 9973) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const subscribeToDpr = (notify: () => void) => {
  const media = window.matchMedia("(min-resolution: 2dppx)");
  media.addEventListener("change", notify);
  window.addEventListener("resize", notify);
  return () => {
    media.removeEventListener("change", notify);
    window.removeEventListener("resize", notify);
  };
};

const readDpr = () =>
  typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

const subscribeToMotion = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

const readMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface PointerInput {
  x: number;
  y: number;
  inside: boolean;
  presses: number;
  pressX: number;
  pressY: number;
}

interface TideSettings {
  colors: string[];
  backgroundColor: string;
  density: number;
  particleSize: number;
  waveHeight: number;
  choppiness: number;
  wavelength: number;
  windAngle: number;
  horizon: number;
  fog: number;
  glow: number;
  blocks: number;
  foam: number;
  speed: number;
  interactive: boolean;
  parallax: number;
  swell: number;
  swellRadius: number;
  clickRipples: boolean;
  seed: number;
  paused: boolean;
  reduced: boolean;
}

interface TideSceneProps {
  settings: TideSettings;
  pointerRef: MutableRefObject<PointerInput>;
  wakeRef: MutableRefObject<(() => void) | null>;
}

interface Motion {
  time: number;
  lookX: number;
  lookY: number;
  cursorX: number;
  cursorZ: number;
  cursorLift: number;
  seeded: boolean;
  presses: number;
  ripples: { x: number; z: number; age: number }[];
  next: number;
}

const buildGrid = (columns: number, rows: number, seed: number) => {
  const count = columns * rows;
  const grid = new Float32Array(count * 2);
  const jitter = new Float32Array(count * 2);
  const positions = new Float32Array(count * 3);
  const next = random(seed + 0.5);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const index = j * columns + i;
      grid[index * 2] = (i / (columns - 1)) * 2 - 1;
      grid[index * 2 + 1] = 1 - j / (rows - 1);
      jitter[index * 2] = (next() - 0.5) * 0.7;
      jitter[index * 2 + 1] = (next() - 0.5) * 0.7;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
  geometry.setAttribute("aJitter", new THREE.BufferAttribute(jitter, 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geometry;
};

const buildSurface = (columns: number, rows: number) => {
  const grid = new Float32Array(columns * rows * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const index = j * columns + i;
      grid[index * 2] = (i / (columns - 1)) * 2 - 1;
      grid[index * 2 + 1] = j / (rows - 1);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      const a = j * columns + i;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(columns * rows * 3), 3),
  );
  geometry.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geometry;
};

const createUniforms = () => ({
  uTime: { value: 0 },
  uNear: { value: 1.5 },
  uFar: { value: FAR },
  uSpread: { value: 0.85 },
  uSpreadBase: { value: 0.85 },
  uRows: { value: BASE_ROWS },
  uColumns: { value: BASE_COLUMNS },
  uWave: {
    value: Array.from({ length: WAVES }, () => new THREE.Vector4()),
  },
  uWaveMotion: {
    value: Array.from({ length: WAVES }, () => new THREE.Vector4()),
  },
  uHeight: { value: 1 },
  uSun: { value: new THREE.Vector3(0.06, 0.07, -1).normalize() },
  uFogDistance: { value: 22 },
  uFoam: { value: 1 },
  uSize: { value: 0.006 },
  uFocal: { value: 900 },
  uPixelRatio: { value: 1 },
  uGlow: { value: 1 },
  uBlocks: { value: 0 },
  uCursor: { value: new THREE.Vector4(0, -8, 0, 0) },
  uCursorRadius: { value: 1.2 },
  uRipple: {
    value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()),
  },
  uTrough: { value: new THREE.Vector3() },
  uCrest: { value: new THREE.Vector3() },
  uInk: { value: 0 },
  uIntensity: { value: 1 },
});

type TideUniforms = ReturnType<typeof createUniforms>;

const TideScene = ({ settings, pointerRef, wakeRef }: TideSceneProps) => {
  const { size, invalidate } = useThree();
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const motionRef = useRef<Motion>({
    time: 30,
    lookX: 0,
    lookY: 0,
    cursorX: 0,
    cursorZ: -8,
    cursorLift: 0,
    seeded: false,
    presses: 0,
    ripples: Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, z: 0, age: 99 })),
    next: 0,
  });
  const helpers = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      hit: new THREE.Vector3(),
    }),
    [],
  );
  const uniforms = useMemo(() => createUniforms(), []);
  const density = clamp(settings.density, 0.3, 2);
  const columns = Math.round(BASE_COLUMNS * density);
  const rows = Math.round(BASE_ROWS * density);
  const geometry = useMemo(
    () => buildGrid(columns, rows, settings.seed),
    [columns, rows, settings.seed],
  );
  const surface = useMemo(() => buildSurface(200, 150), []);
  const [trough, crest] = settings.colors;
  const { backgroundColor, wavelength, windAngle, choppiness, seed } = settings;

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => surface.dispose(), [surface]);

  useEffect(() => {
    wakeRef.current = invalidate;
    return () => {
      wakeRef.current = null;
    };
  }, [invalidate, wakeRef]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    const values = material.uniforms as unknown as TideUniforms;
    readSrgb(values.uTrough.value, trough ?? DEFAULT_COLORS[0], DEFAULT_COLORS[0]);
    readSrgb(values.uCrest.value, crest ?? trough ?? DEFAULT_COLORS[1], DEFAULT_COLORS[1]);
    const transparent = isTransparent(backgroundColor);
    scratch.set(transparent ? "#000000" : backgroundColor);
    const lum = scratch.r * 0.2126 + scratch.g * 0.7152 + scratch.b * 0.0722;
    const ink = !transparent && lum > 0.35;
    values.uInk.value = ink ? 1 : 0;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = ink ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.needsUpdate = true;
    invalidate();
  }, [trough, crest, backgroundColor, invalidate]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    const values = material.uniforms as unknown as TideUniforms;
    const next = random(seed + 1.7);
    const wind = toRadians(windAngle);
    const span = clamp(wavelength, 0.2, 5);
    const longest = 11 * span;
    const shortest = 0.4 * span;
    const chop = clamp(choppiness, 0, 1.5);
    let total = 0;
    const amplitudes: number[] = [];
    for (let i = 0; i < WAVES; i++) {
      const t = i / (WAVES - 1);
      const length = longest * Math.pow(shortest / longest, t) * (0.85 + next() * 0.3);
      const angle = wind + (next() - 0.5) * toRadians(150) * (0.45 + t * 0.55);
      const k = (Math.PI * 2) / length;
      const amplitude = Math.pow(length, 1.2) * 0.012 * (0.7 + next() * 0.6);
      amplitudes.push(amplitude);
      total += amplitude;
      values.uWave.value[i].set(Math.sin(angle), Math.cos(angle), k, amplitude);
      values.uWaveMotion.value[i].set(
        Math.sqrt(9.8 * k) * 0.55,
        next() * Math.PI * 2,
        0,
        0,
      );
    }
    for (let i = 0; i < WAVES; i++) {
      const wave = values.uWave.value[i];
      const normalized = amplitudes[i] / Math.max(total, 1e-5);
      wave.w = normalized * 0.8;
      const k = wave.z;
      values.uWaveMotion.value[i].z = Math.min(
        (chop * 0.9) / Math.max(k * wave.w * WAVES, 1e-4),
        4,
      );
    }
    invalidate();
  }, [seed, windAngle, wavelength, choppiness, invalidate]);

  useEffect(() => {
    invalidate();
  }, [settings, size, invalidate]);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    const values = material.uniforms as unknown as TideUniforms;
    const motion = motionRef.current;
    const s = settings;
    const input = pointerRef.current;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const animate = !s.paused && !s.reduced && s.speed > 0;
    if (animate) motion.time += dt * clamp(s.speed, 0, 4);
    const aspect = size.width / Math.max(size.height, 1);
    const tanHalf = Math.tan(toRadians(FOV) / 2);

    const horizon = clamp(s.horizon, 0.02, 0.45);
    const pitch = Math.atan((1 - 2 * horizon) * tanHalf);
    const tracking = s.interactive && !s.reduced && input.inside;
    const lookTargetX = tracking ? (input.x - 0.5) * 2 : 0;
    const lookTargetY = tracking ? (input.y - 0.5) * 2 : 0;
    const ease = 1 - Math.exp(-dt * 2.2);
    motion.lookX += (lookTargetX - motion.lookX) * ease;
    motion.lookY += (lookTargetY - motion.lookY) * ease;
    const parallax = clamp(s.parallax, 0, 3);
    const perspective = state.camera as THREE.PerspectiveCamera;
    perspective.fov = FOV;
    perspective.near = 0.05;
    perspective.far = 200;
    perspective.aspect = aspect;
    perspective.position.set(
      motion.lookX * 0.12 * parallax,
      CAMERA_HEIGHT + Math.sin(motion.time * 0.35) * 0.04,
      0,
    );
    perspective.rotation.set(
      -pitch + motion.lookY * 0.025 * parallax,
      -motion.lookX * 0.045 * parallax,
      Math.sin(motion.time * 0.27) * 0.006,
      "YXZ",
    );
    perspective.updateProjectionMatrix();
    perspective.updateMatrixWorld();

    let lift = 0;
    if (tracking) {
      helpers.pointer.set(input.x * 2 - 1, input.y * 2 - 1);
      helpers.raycaster.setFromCamera(helpers.pointer, perspective);
      const hit = helpers.raycaster.ray.intersectPlane(helpers.plane, helpers.hit);
      if (hit && hit.z < -0.5 && hit.z > -FAR * 0.6) {
        if (!motion.seeded) {
          motion.cursorX = hit.x;
          motion.cursorZ = hit.z;
          motion.seeded = true;
        }
        const follow = 1 - Math.exp(-dt * 5);
        motion.cursorX += (hit.x - motion.cursorX) * follow;
        motion.cursorZ += (hit.z - motion.cursorZ) * follow;
        lift = 1;
      }
    }
    motion.cursorLift +=
      (lift - motion.cursorLift) *
      (1 - Math.exp(-dt * (lift > motion.cursorLift ? 3 : 1.6)));
    if (motion.cursorLift < 0.002 && !lift) motion.seeded = false;

    if (input.presses !== motion.presses) {
      const fresh = Math.min(input.presses - motion.presses, MAX_RIPPLES);
      motion.presses = input.presses;
      if (s.clickRipples && !s.reduced) {
        helpers.pointer.set(input.pressX * 2 - 1, input.pressY * 2 - 1);
        helpers.raycaster.setFromCamera(helpers.pointer, perspective);
        const hit = helpers.raycaster.ray.intersectPlane(helpers.plane, helpers.hit);
        if (hit && hit.z < -0.5) {
          for (let i = 0; i < fresh; i++) {
            const ripple = motion.ripples[motion.next];
            ripple.x = hit.x;
            ripple.z = hit.z;
            ripple.age = 0;
            motion.next = (motion.next + 1) % MAX_RIPPLES;
          }
        }
      }
    }
    let rippling = false;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const ripple = motion.ripples[i];
      if (ripple.age < 6) ripple.age += dt;
      const strength = ripple.age < 6 ? Math.exp(-ripple.age * 0.75) : 0;
      if (strength > 0.002) rippling = true;
      values.uRipple.value[i].set(ripple.x, ripple.z, ripple.age * 2.2, strength);
    }

    const bottomAngle =
      pitch + toRadians(FOV) / 2 + 0.025 * clamp(s.parallax, 0, 3) + 0.03;
    const near = (CAMERA_HEIGHT / Math.tan(bottomAngle)) * 0.8;
    const pixelRatio = state.viewport.dpr;
    values.uTime.value = motion.time;
    values.uNear.value = near;
    values.uFar.value = FAR;
    const sway = clamp(s.parallax, 0, 3);
    const reach = aspect * tanHalf * 1.2;
    values.uSpread.value = Math.cos(pitch) * reach + Math.tan(0.06 * sway);
    values.uSpreadBase.value =
      CAMERA_HEIGHT * Math.sin(pitch) * reach + 0.14 * sway + 0.35;
    values.uRows.value = rows;
    values.uColumns.value = columns;
    values.uHeight.value = clamp(s.waveHeight, 0, 3);
    values.uFogDistance.value = 140 / clamp(s.fog, 0.1, 4);
    values.uFoam.value = clamp(s.foam, 0, 3);
    values.uSize.value = 0.0028 * clamp(s.particleSize, 0.2, 4);
    values.uFocal.value = size.height / 2 / tanHalf;
    values.uPixelRatio.value = pixelRatio;
    values.uGlow.value = clamp(s.glow, 0, 2);
    values.uBlocks.value = clamp(s.blocks, 0, 1);
    values.uCursor.value.set(
      motion.cursorX,
      motion.cursorZ,
      motion.cursorLift * clamp(s.swell, 0, 3) * 0.14,
      0,
    );
    values.uCursorRadius.value = clamp(s.swellRadius, 0.1, 5);

    const settling =
      rippling ||
      (motion.cursorLift > 0.002 && motion.cursorLift < 0.998) ||
      Math.abs(motion.lookX - lookTargetX) > 0.001 ||
      Math.abs(motion.lookY - lookTargetY) > 0.001;
    if (!animate && (settling || tracking)) invalidate();
  });

  return (
    <>
      <mesh geometry={surface} frustumCulled={false} renderOrder={0}>
        <shaderMaterial
          vertexShader={depthVertexShader}
          fragmentShader={depthFragmentShader}
          uniforms={uniforms}
          colorWrite={false}
          depthWrite
          depthTest
          side={THREE.DoubleSide}
        />
      </mesh>
      <points geometry={geometry} frustumCulled={false} renderOrder={1}>
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthTest
          depthWrite={false}
        />
      </points>
    </>
  );
};

export const ContourTide = ({
  colors = DEFAULT_COLORS,
  backgroundColor = "#0a0a0a",
  density = 1,
  particleSize = 1,
  waveHeight = 1,
  choppiness = 0.8,
  wavelength = 1,
  windAngle = 0,
  horizon = 0.1,
  fog = 1,
  glow = 0.35,
  blocks = 0,
  foam = 1,
  speed = 1,
  interactive = true,
  parallax = 1,
  swell = 1,
  swellRadius = 0.9,
  clickRipples = true,
  seed = 0,
  paused = false,
  dpr = 1.5,
  className,
  style,
  children,
}: ContourTideProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerInput>({
    x: 0.5,
    y: 0.5,
    inside: false,
    presses: 0,
    pressX: 0.5,
    pressY: 0.5,
  });
  const wakeRef = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(true);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    readMotion,
    () => false,
  );
  const deviceDpr = useSyncExternalStore(subscribeToDpr, readDpr, () => 1);
  const pixelRatio = Math.min(deviceDpr, Math.max(dpr, 0.5));
  const animated = !paused && !reducedMotion && speed > 0;
  const transparent = isTransparent(backgroundColor);

  const settings: TideSettings = {
    colors,
    backgroundColor,
    density,
    particleSize,
    waveHeight,
    choppiness,
    wavelength,
    windAngle,
    horizon,
    fog,
    glow,
    blocks,
    foam,
    speed,
    interactive,
    parallax,
    swell,
    swellRadius,
    clickRipples,
    seed,
    paused,
    reduced: reducedMotion,
  };

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const locate = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      const state = pointerRef.current;
      state.x = (event.clientX - box.left) / Math.max(box.width, 1);
      state.y = 1 - (event.clientY - box.top) / Math.max(box.height, 1);
      state.inside = true;
    };
    const move = (event: PointerEvent) => {
      locate(event);
      wakeRef.current?.();
    };
    const press = (event: PointerEvent) => {
      locate(event);
      const state = pointerRef.current;
      state.pressX = state.x;
      state.pressY = state.y;
      state.presses += 1;
      wakeRef.current?.();
    };
    const leave = (event: PointerEvent) => {
      if (event.type === "pointerup" && event.pointerType === "mouse") return;
      pointerRef.current.inside = false;
      wakeRef.current?.();
    };
    node.addEventListener("pointermove", move, { passive: true });
    node.addEventListener("pointerdown", press, { passive: true });
    node.addEventListener("pointerleave", leave, { passive: true });
    node.addEventListener("pointercancel", leave, { passive: true });
    node.addEventListener("pointerup", leave, { passive: true });
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerdown", press);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointercancel", leave);
      node.removeEventListener("pointerup", leave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        backgroundColor: transparent ? undefined : backgroundColor,
        ...style,
      }}
    >
      <div className="absolute inset-0" aria-hidden="true">
        <Canvas
          dpr={pixelRatio}
          frameloop={visible && animated ? "always" : "demand"}
          camera={{ fov: FOV, near: 0.05, far: 200, position: [0, CAMERA_HEIGHT, 0] }}
          gl={{
            antialias: false,
            alpha: true,
            premultipliedAlpha: true,
            powerPreference: "high-performance",
          }}
          style={{ pointerEvents: "none" }}
        >
          <TideScene
            settings={settings}
            pointerRef={pointerRef}
            wakeRef={wakeRef}
          />
        </Canvas>
      </div>
      {children ? (
        <div className="relative z-10 h-full w-full">{children}</div>
      ) : null}
    </div>
  );
};

export default ContourTide;
