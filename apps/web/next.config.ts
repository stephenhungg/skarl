import type { NextConfig } from "next";
import { webConfig } from "./lib/config";

// Agent discovery lives on Convex HTTP; serve it from the public domain too so agents find it at the URL judges type.
const agentPaths = ["/llms.txt", "/skill.md", "/.well-known/agent-card.json", "/.well-known/mcp.json", "/openapi.json", "/proof.json", "/mcp", "/health"];
const config: NextConfig = { poweredByHeader: false, transpilePackages: ["@skarl/contracts", "@skarl/ledger"],
  rewrites: async () => agentPaths.map(source => ({ source, destination: `${webConfig.convexSiteOrigin}${source}` })) };
export default config;
