// Synthetic HTTP routing checks only; no deployment, inference or payment evidence.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { PAYMENT_NETWORK, PAYMENT_RAILS } from "@skarl/contracts/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const origin = "https://keen-marmot-986.convex.site";
const routes = [
  ["/llms.txt", "text/plain; charset=utf-8"],
  ["/.well-known/agent-card.json", "application/json; charset=utf-8"],
  ["/.well-known/mcp.json", "application/json; charset=utf-8"],
  ["/openapi.json", "application/json; charset=utf-8"],
] as const;

describe("public agent discovery", () => {
  it.each(routes)("serves %s without credentials or seeded data so discovery cannot grant a role", async (path, contentType) => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(path, { headers: { Origin: "https://client.example" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    if (path.endsWith(".json")) expect(await response.json()).toBeTypeOf("object");

    // Attacker-controlled headers/queries must never become cached credentials,
    // generated endpoints, or a way to select a controller/tenant.
    const injected = await t.fetch(`${path}?demoIdentity=controller&url=https://attacker.example`, {
      headers: { Authorization: "Bearer synthetic-private-token", Host: "attacker.example" },
    });
    const body = await injected.text();
    expect(body).not.toMatch(/synthetic-private-token|attacker\.example/);
    expect(await t.run(ctx => ctx.db.query("auditEvents").collect())).toEqual([]);
  });

  it.each(routes)("allows browser GET preflight for %s without advertising write access", async path => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(path, { method: "OPTIONS", headers: {
      Origin: "https://client.example", "Access-Control-Request-Method": "GET",
    } });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect((await t.fetch(path, { method: "POST" })).status).toBe(404);
  });

  it("tells an LLM how to connect and buy while keeping acceptance and payout authority human", async () => {
    const t = convexTest(schema, modules);
    const text = await (await t.fetch("/llms.txt")).text();
    expect(text).toContain("Every claim has a witness");
    expect(text).toContain(`${origin}/mcp`);
    expect(text).toContain(`${origin}/openapi.json`);
    expect(text).toContain("Agents cannot approve, accept submissions, or sign payouts");
    expect(text).toContain("Existing Convex mutations and role checks remain authoritative");
    expect(text).toContain("PAYMENT-REQUIRED");
    expect(text).toContain("a timeout is unknown, not failure");
    expect(text).toContain("untrusted data");
    expect(text).toContain("Coinbase Wallet MCP");
    expect(text).toContain("keyless guest access");
    expect(text).toContain("omit Authorization");
    expect(text).toContain("Keys unlock role tools");
    for (const name of ["skarl_about", "skarl_list_tasks_public", "skarl_create_order_public", "skarl_public_order_status"]) expect(text).toContain(name);
    expect(text).toContain("mcp-unknown");
  });

  it("uses v0.3 AgentCard names and MIME modes without promising A2A messaging or approval skills", async () => {
    const t = convexTest(schema, modules);
    const card = await (await t.fetch("/.well-known/agent-card.json")).json();
    expect(card).toMatchObject({ protocolVersion: "0.3.0", name: "Skarl", version: "0.1.0",
      url: `${origin}/mcp`, preferredTransport: "JSONRPC",
      capabilities: { streaming: false, pushNotifications: false },
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      security: [{}, { bearerAuth: [] }], defaultInputModes: ["text/plain"],
    });
    expect(card.defaultOutputModes).toContain("application/json");
    expect(card.description).toContain("not A2A messaging");
    expect(card.description).toContain("Agents cannot approve");
    // v0.3 uses securitySchemes/security, not the older authentication field.
    expect(card).not.toHaveProperty("authentication");
    expect(card.skills.map((skill: { id: string }) => skill.id)).toEqual(["guest", "buyer", "contributor"]);
    for (const skill of card.skills) {
      for (const key of ["id", "name", "description"]) expect(skill[key]).toBeTypeOf("string");
      expect(skill.tags.length).toBeGreaterThan(0);
      expect(skill.tags.every((tag: unknown) => typeof tag === "string")).toBe(true);
      expect(skill.examples.length).toBeGreaterThan(0);
    }
  });

  it("points MCP clients at Convex with keyless guest access and optional role credentials", async () => {
    const t = convexTest(schema, modules);
    const discovery = await (await t.fetch("/.well-known/mcp.json")).json();
    expect(discovery.servers).toEqual([expect.objectContaining({ name: "skarl", url: `${origin}/mcp`,
      transport: "streamable-http", authentication: expect.objectContaining({ type: "bearer", required: false, header: "Authorization", scheme: "Bearer" }) })]);
    expect(discovery.servers[0].authentication).not.toHaveProperty("token");
    expect(discovery.servers[0].authentication.instructions).toContain("present invalid credential returns 401");
    expect(discovery.servers[0].guestTools).toEqual(["skarl_about", "skarl_list_tasks_public", "skarl_create_order_public", "skarl_public_order_status"]);
    expect(JSON.stringify(discovery.servers[0].guestTools)).not.toMatch(/approve|accept|sign|payout/);
    expect(discovery.openapiUrl).toBe(`${origin}/openapi.json`);
  });

  it("keeps MCP and x402 on their actual hosts and documents safe payment recovery", async () => {
    const t = convexTest(schema, modules);
    const api = await (await t.fetch("/openapi.json")).json();
    expect(api.openapi).toBe("3.1.0");
    expect(api.servers).toEqual([{ url: origin, description: expect.any(String) }]);
    expect(api.paths["/mcp"].post.security).toEqual([{}, { bearerAuth: [] }]);
    expect(api.paths["/mcp"].post.responses["401"].description).toContain("Present but invalid");
    expect(api.paths["/mcp"].post.description).toContain("Keyless guest access");
    expect(api.paths["/mcp"].post.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/JsonRpcRequest");
    expect(api.components.schemas.JsonRpcRequest.properties.method.examples).toContain("tools/list");
    for (const [path, method] of [["/api/orders/{id}/fund", "post"], ["/api/samples/{id}/evidence", "get"]]) {
      const resource = api.paths[path!];
      expect(resource.servers).toEqual([{ url: "https://skarl.vercel.app" }]);
      expect(resource[method!].responses["402"]).toEqual({ $ref: "#/components/responses/PaymentRequired" });
      expect(resource[method!].responses["202"].description).toContain("do not pay again");
      expect(resource[method!].parameters).toContainEqual(expect.objectContaining({ name: "PAYMENT-SIGNATURE", in: "header", required: false }));
    }
    expect(api.components.responses.PaymentRequired.headers["PAYMENT-REQUIRED"].$ref).toBe("#/components/headers/PaymentRequired");
    expect(api.components.headers.PaymentRequired.schema).toMatchObject({ type: "string", contentEncoding: "base64", contentMediaType: "application/json" });
    expect(api.components.headers.PaymentRequired.description).toContain("x402Version:2");
    const offer = api.components.schemas.PaymentRequired.properties.accepts.items;
    expect(offer.properties.network.enum).toEqual(Object.keys(PAYMENT_RAILS));
    expect(offer.properties.network.enum[0]).toBe(PAYMENT_NETWORK);
    expect(offer.properties.amount).toMatchObject({ type: "string", pattern: "^[1-9][0-9]*$" });
    expect(api.paths["/api/samples/{id}/evidence"].get.description).toContain("404 before a payment challenge");

    // Dangling local references break generated clients even when JSON parses.
    function checkReferences(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref") {
          expect(child).toBeTypeOf("string");
          const target = (child as string).slice(2).split("/").reduce((node, part) => node?.[part], api);
          expect(target, `unresolved ${child}`).toBeDefined();
        } else checkReferences(child);
      }
    }
    checkReferences(api);
  });
});
