import { configNumber } from "./config.ts";
export interface FrameHash { timestampMs: number; hash: string }
export function validateFrameHashes(hashes: FrameHash[], durationMs?: number): void {
  if (hashes.length < 3 || hashes.length > 12) throw new Error("frame_hash_count_must_be_3_to_12");
  let previous = -1;
  for (const frame of hashes) {
    if (!Number.isSafeInteger(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previous ||
      (frame.timestampMs > (durationMs ?? 30_000)) || !/^[a-f0-9]{16}$/.test(frame.hash)) throw new Error("invalid_frame_dhash");
    previous = frame.timestampMs;
  }
}
export function hamming(left: string, right: string): number {
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`), count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  return count;
}
export interface FrameMatch { leftIndex: number; rightIndex: number; distance: number }
export interface FrameAlignment { score: number; matches: FrameMatch[] }
const informativeHash = (hash: string) => /^[a-f0-9]{16}$/.test(hash) && !/^(0{16}|f{16})$/.test(hash);
const informative = (frames: readonly FrameHash[]) => {
  const hashes = frames.filter(frame => informativeHash(frame.hash)).map(frame => frame.hash);
  return hashes.length >= 3 && new Set(hashes).size >= 2;
};

/** Bounded, order-preserving candidate alignment; not calibrated copy/authorship proof. */
export function alignFrameHashes(left: readonly FrameHash[], right: readonly FrameHash[]): FrameAlignment | null {
  if (left.length < 3 || right.length < 3 || left.length > 12 || right.length > 12 || !informative(left) || !informative(right)) return null;
  type Path = { total: number; matches: FrameMatch[] };
  const limit = Math.min(left.length, right.length);
  // Minimum distance for each prefix pair and exact match count. Skips permit
  // trims at either end; advancing BOTH indices prevents reusing one good frame.
  const paths = Array.from({length:left.length + 1}, () =>
    Array.from({length:right.length + 1}, () => Array<Path | undefined>(limit + 1)));
  paths[0]![0]![0] = {total:0, matches:[]};
  const keep = (i: number, j: number, count: number, path: Path) => {
    const prior = paths[i]![j]![count];
    if (!prior || path.total < prior.total) paths[i]![j]![count] = path;
  };
  for (let i = 0; i <= left.length; i++) for (let j = 0; j <= right.length; j++) {
    const a = left[i], b = right[j];
    const distance = a && b && informativeHash(a.hash) && informativeHash(b.hash) ? hamming(a.hash, b.hash) : Infinity;
    for (let count = 0; count <= limit; count++) {
      const path = paths[i]![j]![count];
      if (!path) continue;
      if (i < left.length) keep(i + 1, j, count, path);
      if (j < right.length) keep(i, j + 1, count, path);
      if (distance <= configNumber("SKARL_DUPLICATE_MAX_FRAME_DISTANCE") && count < limit) keep(i + 1, j + 1, count + 1,
        {total:path.total + distance, matches:[...path.matches, {leftIndex:i, rightIndex:j, distance}]});
    }
  }
  // Prefer the most supporting pairs, then the lowest mean for that count.
  for (let count = limit; count >= 3; count--) {
    const path = paths[left.length]![right.length]![count];
    if (path && path.total <= configNumber("SKARL_DUPLICATE_MAX_MEAN_DISTANCE") * count) return {score:1 - path.total / count / 64, matches:path.matches};
  }
  return null;
}

/** Existing finance/submission callers share exactly the evidence-view alignment. */
export function compareFrameHashes(left: readonly FrameHash[], right: readonly FrameHash[]): number | null {
  return alignFrameHashes(left, right)?.score ?? null;
}
