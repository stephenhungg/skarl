import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["features/contributor/*.test.ts", "features/auth/*.test.ts", "features/replay/*.test.ts"], environment: "node" },
});
