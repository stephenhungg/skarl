import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["features/contributor/*.test.ts"], environment: "node" },
});
