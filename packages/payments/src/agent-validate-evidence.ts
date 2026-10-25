/** Public read-only deployment/Bazaar validation. Never signs or pays. */
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

async function main() {
  const sampleId = process.argv[2];
  if (!sampleId || !/^(sample-)?[a-zA-Z0-9]+$/.test(sampleId) || process.argv.length !== 3) throw new Error("usage");
  let app = process.env.SKARL_APP_URL;
  const deadline = Date.now() + 45 * 60_000;
  let announced = false;
  while (!app && Date.now() < deadline) {
    const status = await readFile(new URL("../../../docs/status.md", import.meta.url), "utf8");
    const line = status.split("\n").find(value => /Production URL/i.test(value));
    app = line?.match(/https:\/\/[^\s<>\]\[()"`*]+/)?.[0];
    if (!app) {
      if (!announced) console.log("Waiting up to 45 minutes for a Production URL line in docs/status.md; no payment is made.");
      announced = true;
      await delay(30_000);
    }
  }
  if (!app) throw new Error("production_url_unavailable");
  const id = sampleId.startsWith("sample-") ? sampleId : `sample-${sampleId}`;
  const resource = new URL(`/api/samples/${id}/evidence`, app);
  if (resource.protocol !== "https:" || resource.username || resource.password) throw new Error("public_https_required");
  const response = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/validate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: resource.href, method: "GET" }), signal: AbortSignal.timeout(60_000),
  });
  const result: unknown = await response.json();
  console.log(JSON.stringify({ resource: resource.href, httpStatus: response.status, result }, null, 2));
  if (!response.ok || !result || typeof result !== "object" || !("valid" in result) || result.valid !== true) process.exitCode = 2;
}
main().catch(() => {
  console.error("Validation did not complete. Usage: pnpm agent:validate-evidence <sampleId>; set SKARL_APP_URL to public HTTPS or publish Production URL in docs/status.md. No payment was made.");
  process.exitCode = 1;
});
