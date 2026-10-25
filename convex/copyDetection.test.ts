import { describe, expect, it } from "vitest";
import { alignFrameHashes, compareFrameHashes, type FrameHash } from "./lib/copyDetection";

// Synthetic fingerprints only; these tests do not establish real-video recall.
const hashes = ["1234567890abcdef", "234567890abcdef1", "34567890abcdef12", "4567890abcdef123", "567890abcdef1234", "67890abcdef12345"];
const frames = (values: string[]): FrameHash[] => values.map((hash, i) => ({hash, timestampMs:(i + 1) * 1000}));
const flip = (hash: string, mask: bigint) => (BigInt(`0x${hash}`) ^ mask).toString(16).padStart(16, "0");

describe("monotonic informative-frame copy candidates", () => {
  it("matches small re-encode-like hash changes", () => {
    expect(compareFrameHashes(frames(hashes), frames(hashes.map(hash => flip(hash, 1n))))).toBe(63 / 64);
  });

  it("matches one-second-trimmed shifted samples in either direction", () => {
    const original = frames(hashes), trimmed = frames(hashes.slice(1));
    const aligned = alignFrameHashes(original, trimmed)!;
    expect(aligned.score).toBe(1);
    expect(aligned.matches.map(pair => [pair.leftIndex, pair.rightIndex])).toEqual([[1,0],[2,1],[3,2],[4,3],[5,4]]);
    expect(alignFrameHashes(trimmed, original)!.score).toBe(aligned.score);
    expect(original[aligned.matches[0]!.leftIndex]!.timestampMs - trimmed[aligned.matches[0]!.rightIndex]!.timestampMs).toBe(1000);
  });

  it("uses a global best alignment instead of greedily taking a late exact match", () => {
    const left = frames(hashes.slice(0, 3));
    const right = frames([flip(hashes[0]!, 1n), hashes[1]!, hashes[2]!, hashes[0]!]);
    const aligned = alignFrameHashes(left, right)!;
    expect(aligned.matches.map(pair => pair.rightIndex)).toEqual([0,1,2]);
    expect(aligned.score).toBe(1 - 1 / 3 / 64);
  });

  it("does not match a different clip or reversed action order", () => {
    expect(compareFrameHashes(frames(hashes), frames(["aaaaaaaaaaaaaaaa", "5555555555555555", "0f0f0f0f0f0f0f0f"]))).toBeNull();
    expect(compareFrameHashes(frames(hashes.slice(0, 4)), frames(hashes.slice(0, 4).reverse()))).toBeNull();
  });

  it("never reuses one matching right frame as three pieces of evidence", () => {
    const repeatedNear = frames([1n,2n,4n].map(mask => flip(hashes[0]!, mask)));
    expect(compareFrameHashes(repeatedNear, frames(hashes.slice(0, 3)))).toBeNull();
  });

  it("requires three informative frames and rejects blank or patterned-static clips", () => {
    for (const value of ["0000000000000000", "ffffffffffffffff", hashes[0]!]) {
      expect(compareFrameHashes(frames([value,value,value,value]), frames([value,value,value]))).toBeNull();
    }
    const sparse = frames([hashes[0]!, hashes[1]!, "0000000000000000", "ffffffffffffffff"]);
    expect(compareFrameHashes(sparse, sparse)).toBeNull();
    expect(compareFrameHashes(frames(hashes.slice(0, 2)), frames(hashes))).toBeNull();
  });

  it("enforces mean <=6 and every matched distance <=10", () => {
    const left = frames(hashes.slice(0, 3));
    const changed = (masks: bigint[]) => frames(masks.map((mask, i) => flip(hashes[i]!, mask)));
    expect(compareFrameHashes(left, changed([63n,63n,63n]))).toBe(1 - 6 / 64);
    expect(compareFrameHashes(left, changed([1023n,15n,15n]))).toBe(1 - 6 / 64);
    expect(compareFrameHashes(left, changed([127n,127n,127n]))).toBeNull();
    expect(compareFrameHashes(left, changed([2047n,1n,1n]))).toBeNull();
  });
});
