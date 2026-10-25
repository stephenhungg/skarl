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
/** Small-corpus candidate check, not a calibrated detector or proof of authorship. */
export function compareFrameHashes(left: readonly FrameHash[], right: readonly FrameHash[]): number | null {
  if (left.length < 3 || left.length !== right.length) return null;
  const informative = (frames: readonly FrameHash[]) => frames.filter(f => !/^(0{16}|f{16})$/.test(f.hash)).length >= 3;
  if (!informative(left) || !informative(right)) return null;
  const distances = left.map((frame, i) => hamming(frame.hash, right[i]!.hash));
  if (distances.some(distance => distance > 10)) return null;
  const mean = distances.reduce((sum, n) => sum + n, 0) / distances.length;
  return mean <= 6 ? 1 - mean / 64 : null;
}
