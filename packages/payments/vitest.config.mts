import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/payments/tests/**/*.test.ts"], environment: "node", server: { deps: { inline: [/@x402\/next/] } } },
});
