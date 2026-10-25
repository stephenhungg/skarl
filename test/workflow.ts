import { expect, vi } from "vitest";

/**
 * Pump immediate Workflow work until its asserted business state is ready.
 * Draining every timer also drains Workpool's recurring two-minute liveness
 * monitor while real async work is pending, which can expire a valid approval.
 * Small steps let async functions settle without fast-forwarding maintenance.
 */
export async function runScheduledUntil(ready: () => Promise<boolean>) {
  const startedAt = Date.now();
  await vi.waitFor(async () => {
    await vi.advanceTimersByTimeAsync(0);
    expect(await ready()).toBe(true);
  }, { timeout: 5_000, interval: 1 });
  expect(Date.now() - startedAt).toBeLessThan(10_000);
}
