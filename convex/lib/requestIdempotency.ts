import type { MutationCtx } from "../_generated/server";
import { digest } from "./finance";

/** Keys identify business requests, never authority. Only trusted ingress calls
 * this helper; the stored hashes keep client keys out of database projections. */
export function validateIdempotencyKey(value: string): string {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new Error("invalid_idempotency_key");
  return value;
}

export async function readIdempotentResult<T>(ctx: MutationCtx, scope: string, keyHash: string, requestHash: string): Promise<T | undefined> {
  const previous = await ctx.db.query("requestIdempotency").withIndex("by_scope_key", q =>
    q.eq("scope", scope).eq("keyHash", keyHash)).unique();
  if (!previous) return undefined;
  if (previous.requestHash !== requestHash) throw new Error("idempotency_key_conflict");
  return JSON.parse(previous.resultJson) as T;
}

export async function saveIdempotentResult(ctx: MutationCtx, scope: string, keyHash: string, requestHash: string, result: unknown) {
  // The caller's state change and this binding commit in the same transaction.
  await ctx.db.insert("requestIdempotency", { scope, keyHash, requestHash, resultJson: JSON.stringify(result), createdAt: Date.now() });
}

export const idempotencyKeyHash = (key: string) => digest({ key: validateIdempotencyKey(key) });
