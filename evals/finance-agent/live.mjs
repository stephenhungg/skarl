import { readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { scoreAnswer } from "./scoring.mjs";

// Explicit deployment and synthetic seed manifest; never defaults to the shared demo tenant.
const [manifestPath] = process.argv.slice(2);
if (!manifestPath || !process.env.CONVEX_URL) {
  console.error("usage: CONVEX_URL=<deployment> pnpm eval:finance-live <synthetic-manifest.json>");
  process.exit(2);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.synthetic !== true || !manifest.orderId || !manifest.demoIdentity || !manifest.idMap || !manifest.requestPrefix) {
  throw new Error("manifest requires synthetic:true, orderId, demoIdentity, idMap, requestPrefix; use an isolated synthetic organization");
}
const goldens = JSON.parse(await readFile(new URL("./goldens.json", import.meta.url), "utf8"));
const client = new ConvexHttpClient(process.env.CONVEX_URL);
if (process.env.FINANCE_EVAL_AUTH_TOKEN) client.setAuth(process.env.FINANCE_EVAL_AUTH_TOKEN);
const replace = value => Object.entries(manifest.idMap).reduce((result, [from, to]) => result.replaceAll(from, to), value);
let failures = 0;
for (const golden of goldens) {
  // Chat's server dispatcher is read-only even when a model follows a hostile request.
  const { chatId } = await client.action(makeFunctionReference("agentChat:askAgent"), {
    orderId: manifest.orderId, demoIdentity: manifest.demoIdentity,
    requestId: `${manifest.requestPrefix}-${golden.id}`,
    question: replace(golden.question),
  });
  const history = await client.query(makeFunctionReference("agentChatData:history"), {
    orderId: manifest.orderId, demoIdentity: manifest.demoIdentity,
  });
  const row = history.find(item => item._id === chatId);
  const score = scoreAnswer(row?.answer, golden, manifest.idMap);
  if (row?.status !== "completed") score.errors.push(`run_status:${row?.status ?? "missing"}`);
  const passed = score.errors.length === 0;
  if (!passed) failures++;
  console.log(JSON.stringify({ case: golden.id, chatId, status: row?.status, passed, errors: score.errors }));
}
console.log(JSON.stringify({ kind: "live_finance_read_only_eval", total: goldens.length, failures }));
process.exitCode = failures ? 1 : 0;
