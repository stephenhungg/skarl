import { PAYMENT_NETWORK } from "@skarl/contracts/chain";
const roles = [
  { name: "Buyer", flow: "Define a demonstration → fund an order → receive a licensed dataset", owner: "Web + Convex", detail: "Task creation, rubric, order funding, delivery manifest." },
  { name: "Contributor", flow: "Record and narrate → see grounded feedback → earn USDC", owner: "Web + verifier", detail: "Consent, private upload, visual evidence, transcript and copy checks." },
  { name: "Operator", flow: "Review evidence → approve exceptions → reconcile the books", owner: "Convex + payments + ledger", detail: "Payables, approval limits, durable payment intents and balanced journals." },
];
export default function Home() {
  return <main>
    <nav><a className="brand" href="/">skarl</a><span className="badge">development scaffold</span></nav>
    <header><p className="eyebrow">human skill. machine-verifiable evidence.</p><h1>Better data starts<br />with real work.</h1><p className="intro">A marketplace for narrated human demonstrations. Multimodal AI checks the evidence; a finance agent manages bounded payments and accounting on Base Sepolia via x402.</p>
      <div className="links"><a className="primary" href="https://github.com/stephenhungg/skarl/tree/main/docs">Read the build docs</a><a href="/api/health">Inspect scaffold status →</a></div>
    </header>
    <section aria-label="Build workstreams" className="roles">{roles.map(role => <article key={role.name}><p className="eyebrow">{role.owner}</p><h2>{role.name}</h2><p>{role.flow}</p><small>{role.detail}</small></article>)}</section>
    <aside><h2>What works here</h2><p>This page, the health endpoint, shared contracts and local finance tests. Auth, media capture, inference, live database connections and transactions still need implementation. No funds move from this scaffold.</p><code>{PAYMENT_NETWORK}</code></aside>
    <footer>Cal Hacks 13.0 · Base Sepolia testnet target · <a href="https://github.com/stephenhungg/skarl/blob/main/docs/workstreams.md">Ownership and handoffs</a></footer>
  </main>;
}
