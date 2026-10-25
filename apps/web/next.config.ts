import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, transpilePackages: ["@skarl/contracts", "@skarl/ledger"] };
export default config;
