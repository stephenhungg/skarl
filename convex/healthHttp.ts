import { makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import { feedSecretMatches } from "./lib/jiraFeed";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
export const get = httpAction(async ctx => {
  try { return json(await ctx.runQuery(makeFunctionReference<"query">("health:integrations"), { sampleAt: Math.floor(Date.now() / 60_000) })); }
  catch { return json({ error: "health_unavailable" }, 503); }
});

/** Existing feed credential, numeric telemetry only; cannot read or mutate business data. */
export const jira = httpAction(async (ctx, request) => {
  if (!await feedSecretMatches(process.env.SKARL_JIRA_FEED_SECRET ?? "", request.headers.get("x-skarl-feed-secret"))) return json({ error: "unauthorized" }, 401);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "invalid_telemetry" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return json({ error: "telemetry_too_large" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(",") !== "lastSyncAt,truncated,uncertainCount") return json({ error: "invalid_telemetry" }, 400);
    await ctx.runMutation(makeFunctionReference<"mutation">("healthData:recordJira"), body);
    return json({ ok: true });
  } catch { return json({ error: "invalid_telemetry" }, 400); }
});
