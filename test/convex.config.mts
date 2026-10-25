import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["convex/**/*.test.ts"], environment: "edge-runtime",
    // Tests pin the exact rubric comparator; deployments run lenient unless this is set.
    env: { SKARL_VERIFIER_STRICT: "1" } },
});
