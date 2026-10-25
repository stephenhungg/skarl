import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import type { ApiFromModules, FunctionReturnType } from "convex/server";
import type * as jiraFeed from "./jiraFeed";
import type * as exceptions from "./exceptions";
import { exceptionFeedItem, feedSecretMatches } from "./lib/jiraFeed";
import { checkPublicRateLimit } from "./lib/publicRateLimit";

type FeedApi = ApiFromModules<{ jiraFeed: typeof jiraFeed; exceptions: typeof exceptions }>;
const snapshotRef = makeFunctionReference<"query", {}, FunctionReturnType<FeedApi["jiraFeed"]["snapshot"]>>("jiraFeed:snapshot");
const exceptionsRef = makeFunctionReference("exceptions:list") as FeedApi["exceptions"]["list"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

const http = httpRouter();
http.route({ path: "/jira/feed", method: "GET", handler: httpAction(async (ctx, request) => {
  const limited = await checkPublicRateLimit(ctx, request, "jira");
  if (limited) return limited;
  const expected = process.env.SKARL_JIRA_FEED_SECRET ?? "";
  if (expected.length < 32 || expected.length > 512) return json({ error: "jira_feed_not_configured" }, 503);
  if (!await feedSecretMatches(expected, request.headers.get("x-skarl-feed-secret"))) return json({ error: "unauthorized" }, 401);
  // No client-selected organization, order, principal, callback URL, or mutation.
  if (new URL(request.url).search) return json({ error: "query_parameters_not_supported" }, 400);
  try {
    const { items, scopes } = await ctx.runQuery(snapshotRef, {});
    for (const scope of scopes) {
      const result = await ctx.runQuery(exceptionsRef, { demoIdentity: "finance-agent", orderId: scope.orderId });
      for (const row of result.filter(row => row.stillDetected).slice(0, 200)) {
        // A resolved annotation cannot hide a discrepancy that is still detected.
        const exception = row.exception;
        const linked = scope.linked.find(row => row.eventKey === exception.eventKey);
        const item = exceptionFeedItem(exception, scope.orderId, scope.createdAt, linked?.amountMicroUsdc, linked?.witnessReceiptUrl);
        item.simulated ||= scope.simulated;
        items.push(item);
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return json({ version: 1, generatedAt: Date.now(), items: items.slice(0, 200),
      truncated: items.length > 200 || scopes.length === 20 });
  } catch {
    // Do not leak internal errors, database identifiers, credentials or raw input.
    return json({ error: "jira_feed_unavailable" }, 503);
  }
}) });
export default http;

// Public agent discovery is served by Convex so it does not need a web deployment.
import { llms, card, mcp as mcpDiscovery, apiSpec, preflight, skill } from "./agentDiscovery";
http.route({ path: "/llms.txt", method: "GET", handler: llms });
http.route({ path: "/skill.md", method: "GET", handler: skill });
http.route({ path: "/.well-known/agent-card.json", method: "GET", handler: card });
http.route({ path: "/.well-known/mcp.json", method: "GET", handler: mcpDiscovery });
http.route({ path: "/openapi.json", method: "GET", handler: apiSpec });
for (const path of ["/llms.txt", "/skill.md", "/.well-known/agent-card.json", "/.well-known/mcp.json", "/openapi.json"]) {
  http.route({ path, method: "OPTIONS", handler: preflight });
}

// Append-only integration: preserve the concurrently maintained Jira feed.
import { handle as mcpHandler } from "./mcp";
http.route({ path: "/mcp", method: "POST", handler: mcpHandler });
http.route({ path: "/mcp", method: "GET", handler: mcpHandler });

// Additive auth endpoints; keep Jira, MCP and agent discovery routes intact.
import { auth } from "./auth";
auth.addHttpRoutes(http);

import { handle as proofHandler } from "./proofPublic";
http.route({ path: "/proof.json", method: "GET", handler: proofHandler });
http.route({ path: "/proof.json", method: "OPTIONS", handler: preflight });
import { get as healthGet, jira as jiraHealth } from "./healthHttp";
http.route({ path: "/health", method: "GET", handler: healthGet });
http.route({ path: "/health/jira", method: "POST", handler: jiraHealth });
