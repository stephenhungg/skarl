import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
afterEach(() => vi.unstubAllEnvs());
it("exposes only configuration booleans for backend credentials", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("GEMINI_API_KEY", "synthetic-private-model-key");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "synthetic-private-payment-secret-32");
  const result = await t.query(api.health.status, {});
  expect(result).toMatchObject({ inferenceConfigured: true, paymentsServiceConfigured: true,
    modelAvailabilityCheckedByHealth: false });
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "short");
  expect(await t.query(api.health.status, {})).toMatchObject({ inferenceConfigured: false, paymentsServiceConfigured: false });
});
