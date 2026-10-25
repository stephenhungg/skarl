import { expect, test } from 'bun:test';
import { estimateIntrinsics } from './cameraIntrinsics';

test('unknown hardware stays uncalibrated; known models only receive explicitly estimated intrinsics', () => {
  expect(estimateIntrinsics('Unknown phone', 720, 1280)).toBeNull();
  expect(estimateIntrinsics('iPhone 15', 0, 1280)).toBeNull();
  expect(estimateIntrinsics('iPhone 15', Infinity, 1280)).toBeNull();
  const portrait = estimateIntrinsics('iPhone 15', 720, 1280);
  const landscape = estimateIntrinsics('iPhone 15', 1280, 720);
  expect(portrait.estimated).toBe(true);
  expect(portrait.fx).toBeCloseTo(1280 * 26 / 36);
  expect(portrait.cx).toBe(360);
  expect(portrait.cy).toBe(640);
  expect(portrait.horizontalFovDegrees).toBeLessThan(landscape.horizontalFovDegrees);
});
