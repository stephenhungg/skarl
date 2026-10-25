import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise Node's real TypeScript strip-only loader, not Vitest's TS transform.
// Invalid arguments exit before account/API operations or signing.
describe("CDP CLI entrypoints under pinned Node", () => {
  it.each([
    ["packages/payments/src/agent-buy-evidence.ts", [], "Usage: pnpm agent:buy-evidence"],
    ["packages/payments/src/agent-fund.ts", ["--cdp", "too", "many"], "Usage: pnpm agent:fund --cdp"],
  ] as const)("loads %s without unsupported TypeScript syntax", (entry, args, usage) => {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 15_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(usage);
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });
});
