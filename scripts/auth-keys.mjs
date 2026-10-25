import { generateKeyPairSync } from "node:crypto";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--prod")) {
  throw new Error("Usage: node scripts/auth-keys.mjs [--prod]");
}
const target = args[0] === "--prod" ? " --prod" : "";
// No filesystem or subprocess access: secrets leave this script only on stdout.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig", alg: "RS256" }] });
const quote = value => `'${value.replace(/'/g, `'"'"'`)}'`;
// End option parsing before the PEM value, whose leading dashes are significant.
process.stdout.write(`pnpm exec convex env set${target} -- JWT_PRIVATE_KEY ${quote(pem)}\n`);
process.stdout.write(`pnpm exec convex env set${target} -- JWKS ${quote(jwks)}\n`);
