export type Intrinsics = {
  estimated: true; width: number; height: number; fx: number; fy: number; cx: number; cy: number;
  horizontalFovDegrees: number; source: string;
};
// Full-frame-equivalent main-lens focal lengths: Apple iPhone 14/15/15 Pro
// tech specs (support.apple.com/en-us/111850, /111831, /111829). This pinhole
// estimate ignores stabilization crop, lens distortion and focus breathing.
const equivalentFocalLength: Record<string, number> = {
  'iPhone 14': 26, 'iPhone 14 Plus': 26, 'iPhone 15': 26, 'iPhone 15 Plus': 26,
  'iPhone 15 Pro': 24, 'iPhone 15 Pro Max': 24,
};
export function estimateIntrinsics(model: string, width: number, height: number): Intrinsics | null {
  const focal = equivalentFocalLength[model];
  if (!focal || ![width, height].every(Number.isFinite) || !(width > 0 && height > 0)) return null;
  // 36 mm is the long edge of a full-frame sensor. Portrait video rotates it.
  const f = Math.max(width, height) * focal / 36;
  return { estimated: true, width, height, fx: f, fy: f, cx: width / 2, cy: height / 2,
    horizontalFovDegrees: 2 * Math.atan(width / (2 * f)) * 180 / Math.PI,
    source: 'iphone-main-lens-fov-lookup-v1' };
}
