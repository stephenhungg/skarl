import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["evals/finance-agent/*.test.ts"], environment: "node" } });
