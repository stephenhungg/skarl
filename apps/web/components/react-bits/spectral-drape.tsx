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

export interface SpectralDrapeProps {
  colors?: string[];
  backgroundColor?: string;
  density?: number;
  dotSize?: number;
  strands?: number;
  amplitude?: number;
  frequency?: number;
  thickness?: number;
  depth?: number;
  softness?: number;
  intensity?: number;
  colorShift?: number;
  tilt?: number;
  turn?: number;
  roll?: number;
  zoom?: number;
  flow?: number;
  speed?: number;
  interactive?: boolean;
  brush?: number;
  brushRadius?: number;
  parallax?: number;
  clickRipples?: boolean;
  seed?: number;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const DEFAULT_COLORS = ["#6A4BFF", "#E4DBFF"];
const FOV = 38;
const DISTANCE = 9;
const PLANE = 11;
const BASE_COLUMNS = 260;
const BASE_ROWS = 170;
const MAX_STRANDS = 12;
const MAX_RIPPLES = 4;

const vertexShader = `
#define MAX_STRANDS ${MAX_STRANDS}
#define MAX_RIPPLES ${MAX_RIPPLES}

attribute vec2 aGrid;

uniform float uTime;
uniform float uClock;
uniform float uSeed;
uniform float uStrands;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uThickness;
uniform float uDepth;
uniform float uSpacing;
uniform float uSize;
uniform float uViewHeight;
uniform float uIntensity;
uniform float uShift;
uniform vec3 uBodyLab;
uniform vec3 uGlowLab;
uniform vec3 uWake;
uniform vec3 uWakeVector;
uniform float uWakeRadius;
uniform float uAspect;
uniform vec4 uRipple[MAX_RIPPLES];

varying vec3 vColor;
varying float vGlow;

float hash(float n) {
  return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453);
}

vec3 labToLinear(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float strands(vec2 g, float t) {
  float sum = 0.0;
  for (int k = 0; k < MAX_STRANDS; k++) {
    float index = float(k);
    if (index >= uStrands) break;
    float a = hash(index + 1.0);
    float b = hash(index + 17.0);
    float c = hash(index + 43.0);
    float frequency = uFrequency * (0.55 + 0.9 * a);
    float phase = b * 6.2831853;
    float along = g.x * 6.2831853 * frequency;
    float wave =
      sin(along + phase + t * (0.35 + 0.45 * a)) * 0.62 +
      sin(along * 2.07 - phase * 1.31 - t * (0.27 + 0.36 * b)) * 0.26 +
      sin(along * 0.47 + phase * 0.7 + t * (0.19 + 0.2 * c)) * 0.3;
    float line = 0.5 + (c - 0.5) * 0.8 + uAmplitude * 0.16 * wave;
    float width = uThickness * (0.022 + 0.05 * c) * (0.75 + 0.5 * sin(along * 0.5 + t * 0.4 + phase));
    float d = (g.y - line) / max(width, 0.004);
    sum += exp(-d * d);
  }
  float edge = smoothstep(0.0, 0.12, g.y) * (1.0 - smoothstep(0.88, 1.0, g.y)) *
    smoothstep(0.0, 0.05, g.x) * (1.0 - smoothstep(0.95, 1.0, g.x));
  return (1.0 - exp(-sum * 1.1)) * edge;
}

void main() {
  float field = strands(aGrid, uTime);
  vec3 local = vec3((aGrid.x - 0.5) * ${PLANE}.0, (aGrid.y - 0.5) * ${PLANE}.0, field * uDepth);

  float reveal = 0.0;
  for (int k = 0; k < MAX_RIPPLES; k++) {
    vec4 ripple = uRipple[k];
    float age = uClock - ripple.z;
    if (ripple.w <= 0.0 || age < 0.0 || age > 6.0) continue;
    float radius = length((aGrid - ripple.xy) * ${PLANE}.0);
    float front = radius - age * 3.4;
    float envelope = exp(-front * front * 3.0) * exp(-age * 0.5) * ripple.w;
    local.z += sin(front * 3.2) * 0.3 * envelope;
    reveal += envelope;
  }

  vec4 world = modelMatrix * vec4(local, 1.0);
  vec4 clip = projectionMatrix * viewMatrix * world;
  vec2 ndc = clip.xy / clip.w;
  vec2 offset = (ndc - uWake.xy) * vec2(uAspect, 1.0);
  float touch = exp(-dot(offset, offset) / max(uWakeRadius * uWakeRadius, 1e-4)) * uWake.z;
  world.xyz += uWakeVector * touch;

  vec4 view = viewMatrix * world;
  gl_Position = projectionMatrix * view;

  float eye = -view.z;
  float size = uSpacing * uSize * projectionMatrix[1][1] * uViewHeight * 0.5 / max(eye, 0.1);
  float nearness = clamp(${DISTANCE}.0 / max(eye, 0.1), 0.35, 1.8);
  float shade = mix(0.35, 1.0, smoothstep(0.55, 1.2, nearness));

  float lift = smoothstep(0.06, 0.95, field);
  float glow = (pow(lift, 1.35) * 1.3 + reveal * 1.1) * shade * uIntensity;
  float shown = max(size, 1.35);
  vGlow = glow * min(size * size / (shown * shown), 1.0);
  gl_PointSize = shown * (1.0 + touch * 0.35);

  float tone = clamp(lift * 0.9 + (aGrid.x - 0.5) * uShift + reveal * 0.25, 0.0, 1.0);
  vec3 lab = mix(uBodyLab, uGlowLab, tone);
  vColor = toSrgb(max(labToLinear(lab), vec3(0.0)));
}
`;

const fragmentShader = `
precision highp float;

uniform float uSoftness;
uniform float uInk;

varying vec3 vColor;
varying float vGlow;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float disc = 1.0 - smoothstep(mix(0.55, 0.0, uSoftness), 1.0, r);
  float amount = disc * vGlow;
  if (amount < 0.003) discard;
  if (uInk > 0.5) {
    float alpha = clamp(amount, 0.0, 1.0);
    gl_FragColor = vec4(vColor * alpha, alpha);
  } else {
    gl_FragColor = vec4(vColor * amount, clamp(amount, 0.0, 1.0));
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

const readColor = (target: THREE.Color, value: string, fallback: string) => {
  const trimmed = value.trim();
  try {
    target.set(/^#[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(0, 7) : trimmed);
  } catch {
    target.set(fallback);
  }
  return target;
};

const toLab = (target: THREE.Vector3, color: THREE.Color) => {
  const l = Math.cbrt(
    0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b,
  );
  const m = Math.cbrt(
    0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b,
  );
  const s = Math.cbrt(
    0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b,
  );
  return target.set(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
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

interface DrapeSettings {
  colors: string[];
  backgroundColor: string;
  density: number;
  dotSize: number;
  strands: number;
  amplitude: number;
  frequency: number;
  thickness: number;
  depth: number;
  softness: number;
  intensity: number;
  colorShift: number;
  tilt: number;
  turn: number;
  roll: number;
  zoom: number;
  flow: number;
  speed: number;
  interactive: boolean;
  brush: number;
  brushRadius: number;
  parallax: number;
  clickRipples: boolean;
  seed: number;
  paused: boolean;
  reduced: boolean;
}

interface DrapeSceneProps {
  settings: DrapeSettings;
  pointerRef: MutableRefObject<PointerInput>;
  wakeRef: MutableRefObject<(() => void) | null>;
}

interface Motion {
  time: number;
  clock: number;
  leanX: number;
  leanY: number;
  wakeX: number;
  wakeY: number;
  lastX: number;
  lastY: number;
  hasLast: boolean;
  velocityX: number;
  velocityY: number;
  strength: number;
  presses: number;
  nextRipple: number;
  ripples: THREE.Vector4[];
}

const createUniforms = () => ({
  uTime: { value: 0 },
  uClock: { value: 0 },
  uSeed: { value: 0 },
  uStrands: { value: 8 },
  uAmplitude: { value: 1 },
  uFrequency: { value: 0.6 },
  uThickness: { value: 1 },
  uDepth: { value: 1.6 },
  uSpacing: { value: 0.04 },
  uSize: { value: 0.5 },
  uViewHeight: { value: 600 },
  uIntensity: { value: 1 },
  uShift: { value: 0 },
  uBodyLab: { value: new THREE.Vector3() },
  uGlowLab: { value: new THREE.Vector3() },
  uWake: { value: new THREE.Vector3(9, 9, 0) },
  uWakeVector: { value: new THREE.Vector3() },
  uWakeRadius: { value: 0.3 },
  uAspect: { value: 1 },
  uRipple: {
    value: Array.from(
      { length: MAX_RIPPLES },
      () => new THREE.Vector4(0, 0, -99, 0),
    ),
  },
  uSoftness: { value: 0.6 },
  uInk: { value: 0 },
});

type DrapeUniforms = ReturnType<typeof createUniforms>;

const buildGrid = (density: number) => {
  const scale = Math.sqrt(clamp(density, 0.2, 2.5));
  const columns = Math.max(24, Math.round(BASE_COLUMNS * scale));
  const rows = Math.max(16, Math.round(BASE_ROWS * scale));
  const grid = new Float32Array(columns * rows * 2);
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      grid[offset++] = column / (columns - 1);
      grid[offset++] = row / (rows - 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(columns * rows * 3), 3),
  );
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANE * 2);
  return { geometry, spacing: PLANE / (columns - 1) };
};

const DrapeScene = ({ settings, pointerRef, wakeRef }: DrapeSceneProps) => {
  const { size, invalidate } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const motionRef = useRef<Motion>({
    time: 0,
    clock: 0,
    leanX: 0,
    leanY: 0,
    wakeX: 9,
    wakeY: 9,
    lastX: 0.5,
    lastY: 0.5,
    hasLast: false,
    velocityX: 0,
    velocityY: 0,
    strength: 0,
    presses: 0,
    nextRipple: 0,
    ripples: Array.from(
      { length: MAX_RIPPLES },
      () => new THREE.Vector4(0, 0, -99, 0),
    ),
  });
  const helpers = useMemo(
    () => ({
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      plane: new THREE.Plane(),
      normal: new THREE.Vector3(),
      point: new THREE.Vector3(),
      inverse: new THREE.Matrix4(),
      euler: new THREE.Euler(),
    }),
    [],
  );
  const uniforms = useMemo(() => createUniforms(), []);
  const grid = useMemo(() => buildGrid(settings.density), [settings.density]);
  const colorKey = settings.colors.join("|");
  const { backgroundColor } = settings;

  useEffect(() => () => grid.geometry.dispose(), [grid]);

  useEffect(() => {
    wakeRef.current = invalidate;
    return () => {
      wakeRef.current = null;
    };
  }, [invalidate, wakeRef]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    const values = material.uniforms as unknown as DrapeUniforms;
    const palette = colorKey ? colorKey.split("|") : DEFAULT_COLORS;
    const color = new THREE.Color();
    readColor(color, palette[0] ?? DEFAULT_COLORS[0], DEFAULT_COLORS[0]);
    toLab(values.uBodyLab.value, color);
    readColor(
      color,
      palette[1] ?? palette[0] ?? DEFAULT_COLORS[1],
      DEFAULT_COLORS[1],
    );
    toLab(values.uGlowLab.value, color);
    const transparent = isTransparent(backgroundColor);
    readColor(color, transparent ? "#000000" : backgroundColor, "#000000");
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    const ink = !transparent && luminance > 0.25;
    values.uInk.value = ink ? 1 : 0;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = ink ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.needsUpdate = true;
    invalidate();
  }, [colorKey, backgroundColor, invalidate]);

  useEffect(() => {
    invalidate();
  }, [settings, size, invalidate]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material) return;
    const values = material.uniforms as unknown as DrapeUniforms;
    const motion = motionRef.current;
    const s = settings;
    const input = pointerRef.current;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const animate = !s.paused && !s.reduced;
    if (animate) {
      motion.time += dt * clamp(s.speed, 0, 4) * clamp(s.flow, 0, 4) * 0.3;
    }
    if (!s.reduced) motion.clock += dt;

    const aspect = size.width / Math.max(size.height, 1);
    const camera = state.camera as THREE.PerspectiveCamera;
    const tracking = s.interactive && !s.reduced && input.inside;
    const parallax = clamp(s.parallax, 0, 3);
    const leanTargetX = tracking ? (input.x - 0.5) * 2 : 0;
    const leanTargetY = tracking ? (input.y - 0.5) * 2 : 0;
    const ease = 1 - Math.exp(-dt * 2.2);
    motion.leanX += (leanTargetX - motion.leanX) * ease;
    motion.leanY += (leanTargetY - motion.leanY) * ease;

    helpers.euler.set(
      toRadians(clamp(s.tilt, -180, 180)) - motion.leanY * 0.06 * parallax,
      toRadians(clamp(s.turn, -180, 180)) + motion.leanX * 0.08 * parallax,
      toRadians(clamp(s.roll, -180, 180)),
      "XYZ",
    );
    group.rotation.copy(helpers.euler);
    group.scale.setScalar(clamp(s.zoom, 0.3, 3));
    group.updateMatrixWorld();

    let velocityX = 0;
    let velocityY = 0;
    if (tracking) {
      if (!motion.hasLast) {
        motion.lastX = input.x;
        motion.lastY = input.y;
        motion.wakeX = input.x;
        motion.wakeY = input.y;
        motion.hasLast = true;
      }
      if (dt > 0) {
        velocityX = (input.x - motion.lastX) / dt;
        velocityY = (input.y - motion.lastY) / dt;
      }
      motion.lastX = input.x;
      motion.lastY = input.y;
    } else {
      motion.hasLast = false;
    }
    const smoothing = 1 - Math.exp(-dt * 6);
    motion.velocityX += (clamp(velocityX, -5, 5) - motion.velocityX) * smoothing;
    motion.velocityY += (clamp(velocityY, -5, 5) - motion.velocityY) * smoothing;
    const follow = 1 - Math.exp(-dt * 7);
    if (tracking) {
      motion.wakeX += (input.x - motion.wakeX) * follow;
      motion.wakeY += (input.y - motion.wakeY) * follow;
    }
    const speed = Math.hypot(motion.velocityX * aspect, motion.velocityY);
    const strengthTarget = tracking ? clamp(speed * 0.9, 0, 1.4) : 0;
    motion.strength += (strengthTarget - motion.strength) * (1 - Math.exp(-dt * 4));

    camera.updateMatrixWorld();
    helpers.right.setFromMatrixColumn(camera.matrixWorld, 0);
    helpers.up.setFromMatrixColumn(camera.matrixWorld, 1);
    const reach = DISTANCE * Math.tan(toRadians(FOV) / 2);
    const brush = clamp(s.brush, 0, 3);
    const directionX = motion.velocityX / Math.max(speed, 1e-4);
    const directionY = motion.velocityY / Math.max(speed, 1e-4);
    values.uWake.value.set(
      motion.wakeX * 2 - 1,
      motion.wakeY * 2 - 1,
      motion.strength * brush,
    );
    values.uWakeVector.value
      .copy(helpers.right)
      .multiplyScalar(directionX * aspect * reach * 0.16)
      .addScaledVector(helpers.up, directionY * reach * 0.16);
    values.uWakeRadius.value = clamp(s.brushRadius, 0.03, 1);

    if (input.presses !== motion.presses) {
      motion.presses = input.presses;
      if (s.clickRipples && s.interactive && !s.reduced) {
        helpers.ndc.set(input.pressX, input.pressY);
        helpers.raycaster.setFromCamera(helpers.ndc, camera);
        helpers.normal.set(0, 0, 1).transformDirection(group.matrixWorld);
        helpers.point.setFromMatrixPosition(group.matrixWorld);
        helpers.plane.setFromNormalAndCoplanarPoint(helpers.normal, helpers.point);
        const hit = helpers.raycaster.ray.intersectPlane(helpers.plane, helpers.point);
        if (hit) {
          helpers.inverse.copy(group.matrixWorld).invert();
          helpers.point.applyMatrix4(helpers.inverse);
          const slot = motion.nextRipple;
          motion.nextRipple = (slot + 1) % MAX_RIPPLES;
          motion.ripples[slot].set(
            clamp(helpers.point.x / PLANE + 0.5, -0.5, 1.5),
            clamp(helpers.point.y / PLANE + 0.5, -0.5, 1.5),
            motion.clock,
            1,
          );
        }
      }
    }
    let rippling = false;
    for (let k = 0; k < MAX_RIPPLES; k++) {
      values.uRipple.value[k].copy(motion.ripples[k]);
      if (motion.ripples[k].w > 0 && motion.clock - motion.ripples[k].z < 6) {
        rippling = true;
      }
    }

    values.uTime.value = motion.time;
    values.uClock.value = motion.clock;
    values.uSeed.value = s.seed * 0.137;
    values.uStrands.value = Math.round(clamp(s.strands, 1, MAX_STRANDS));
    values.uAmplitude.value = clamp(s.amplitude, 0, 3);
    values.uFrequency.value = clamp(s.frequency, 0.05, 4) * 0.6;
    values.uThickness.value = clamp(s.thickness, 0.2, 4);
    values.uDepth.value = clamp(s.depth, 0, 3) * 1.6;
    values.uSpacing.value = grid.spacing;
    values.uSize.value = clamp(s.dotSize, 0.1, 4) * 0.5;
    values.uViewHeight.value = size.height * state.viewport.dpr;
    values.uIntensity.value = clamp(s.intensity, 0, 4);
    values.uShift.value = clamp(s.colorShift, -1, 1);
    values.uAspect.value = aspect;
    values.uSoftness.value = clamp(s.softness, 0, 1);

    const moving =
      rippling ||
      motion.strength > 0.002 ||
      Math.abs(motion.leanX - leanTargetX) > 1e-3 ||
      Math.abs(motion.leanY - leanTargetY) > 1e-3;
    if (!animate && moving) invalidate();
  });

  return (
    <group ref={groupRef}>
      <points geometry={grid.geometry} frustumCulled={false}>
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </points>
    </group>
  );
};

export const SpectralDrape = ({
  colors = DEFAULT_COLORS,
  backgroundColor = "#0a0a0a",
  density = 1,
  dotSize = 1,
  strands = 8,
  amplitude = 1,
  frequency = 1,
  thickness = 0.7,
  depth = 1,
  softness = 0.6,
  intensity = 1,
  colorShift = 0.3,
  tilt = -40,
  turn = -45,
  roll = 110,
  zoom = 1,
  flow = 1,
  speed = 1,
  interactive = true,
  brush = 1,
  brushRadius = 0.2,
  parallax = 1,
  clickRipples = true,
  seed = 0,
  paused = false,
  dpr = 2,
  className,
  style,
  children,
}: SpectralDrapeProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerInput>({
    x: 0.5,
    y: 0.5,
    inside: false,
    presses: 0,
    pressX: 0,
    pressY: 0,
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
  const animated = !paused && !reducedMotion;
  const transparent = isTransparent(backgroundColor);

  const settings: DrapeSettings = {
    colors,
    backgroundColor,
    density,
    dotSize,
    strands,
    amplitude,
    frequency,
    thickness,
    depth,
    softness,
    intensity,
    colorShift,
    tilt,
    turn,
    roll,
    zoom,
    flow,
    speed,
    interactive,
    brush,
    brushRadius,
    parallax,
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
    const down = (event: PointerEvent) => {
      locate(event);
      const state = pointerRef.current;
      state.pressX = state.x * 2 - 1;
      state.pressY = state.y * 2 - 1;
      state.presses += 1;
      wakeRef.current?.();
    };
    const leave = () => {
      pointerRef.current.inside = false;
      wakeRef.current?.();
    };
    node.addEventListener("pointermove", move, { passive: true });
    node.addEventListener("pointerdown", down, { passive: true });
    node.addEventListener("pointerleave", leave, { passive: true });
    node.addEventListener("pointercancel", leave, { passive: true });
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointercancel", leave);
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
          camera={{ fov: FOV, near: 0.1, far: 100, position: [0, 0, DISTANCE] }}
          gl={{
            antialias: false,
            alpha: true,
            premultipliedAlpha: true,
            powerPreference: "high-performance",
          }}
          style={{ pointerEvents: "none" }}
        >
          <DrapeScene
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

export default SpectralDrape;
