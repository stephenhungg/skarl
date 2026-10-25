"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SectionHeader } from "@/components/section-header";

const MCP_URL = "https://keen-marmot-986.convex.site/mcp";
// Cursor's install link takes the base64-encoded server config, without the mcpServers wrapper.
const CURSOR_INSTALL_URL = "cursor://anysphere.cursor-deeplink/mcp/install?name=skarl&config=eyJ1cmwiOiJodHRwczovL2tlZW4tbWFybW90LTk4Ni5jb252ZXguc2l0ZS9tY3AifQ%3D%3D";
// One prompt for any MCP-capable agent: agents that can install MCP servers do it; chat apps print setup steps.
const UNIVERSAL_PROMPT = `Connect yourself to Skarl, a marketplace for verified robot-training demonstrations.

1. Add this remote MCP server named "skarl" (Streamable HTTP, no API key needed):
   ${MCP_URL}
   If you can't add MCP servers yourself, give me the exact steps for the app I'm using.
2. Read https://keen-marmot-986.convex.site/llms.txt and call the skarl_about tool.
3. Show me the open tasks and what each one pays.

Rules: ask me before creating an order or paying anything; payments use x402 (test USDC on Base Sepolia). You can propose and pay, but only humans approve payouts.`;
const CLIENTS = [
  {
    id: "claude-code", label: "Claude Code", heading: "Run once in your terminal.",
    detail: "Then ask Claude to use Skarl. No API key or account setup needed for public tools.",
    snippet: `claude mcp add --transport http skarl ${MCP_URL}`,
  },
  {
    id: "cursor", label: "Cursor", heading: "Add Skarl directly to Cursor.",
    detail: "Open the install link, or copy this JSON into your Cursor MCP configuration.",
    snippet: JSON.stringify({ mcpServers: { skarl: { url: MCP_URL } } }, null, 2),
  },
  {
    id: "vs-code", label: "VS Code", heading: "Run once in your terminal.",
    detail: "This adds Skarl to your VS Code user profile. Open Copilot chat to use its tools.",
    snippet: `code --add-mcp '${JSON.stringify({ name: "skarl", type: "http", url: MCP_URL })}'`,
  },
  {
    id: "other-clients", label: "Claude.ai / ChatGPT", heading: "Paste the URL into a custom connector.",
    detail: "Works with any MCP client that supports remote HTTP servers. Custom connector availability depends on your client and plan.",
    snippet: MCP_URL,
  },
  {
    id: "coinbase-wallet", label: "Pay with Coinbase Wallet", heading: "Connect your wallet to Claude Code.",
    detail: "Add Coinbase Wallet MCP alongside Skarl, then sign in to your wallet to fund orders through x402.",
    snippet: "claude mcp add --transport http base-mcp https://wallet-mcp.coinbase.com",
  },
] as const;

function CopySnippet({ text, label, light = false }: { text: string; label: string; light?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className={`rounded-[10px] p-4 min-[810px]:p-5 ${light ? "bg-paper text-ink" : "bg-ink text-paper"}`}>
      <div className="flex items-start gap-4">
        <pre className="mono m-0 min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-[1.7] min-[810px]:text-[14px]"><code>{text}</code></pre>
        <button
          type="button"
          onClick={copy}
          aria-label={state === "copied" ? `${label} copied` : `Copy ${label}`}
          className={`cut-medium min-h-10 min-w-[76px] shrink-0 rounded-[7px] px-3 text-[13px] transition-colors duration-300 ease-[var(--ease-settle)] ${light ? "bg-mist text-deep hover:bg-haze" : "bg-accent text-accent-ink hover:bg-paper"}`}
        >
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p role="status" className={`m-0 text-[12px] leading-[1.4] ${state === "failed" ? "mt-3" : "sr-only"}`}>
        {state === "copied" ? `${label} copied to clipboard.` : state === "failed" ? "Clipboard unavailable. Select and copy the text above." : ""}
      </p>
    </div>
  );
}

export function ConnectAgent() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % CLIENTS.length; break;
      case "ArrowLeft": next = (index + CLIENTS.length - 1) % CLIENTS.length; break;
      case "Home": next = 0; break;
      case "End": next = CLIENTS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="connect-agent" aria-labelledby="connect-agent-title" className="bg-mist pb-[108px] pt-[72px] min-[810px]:pb-[144px] min-[810px]:pt-[108px]">
      <div className="frame">
        <SectionHeader id="connect-agent-title" eyebrow="For your AI" title="Connect your agent" />
        <p className="mx-auto mt-4 max-w-[580px] text-center text-[16px] leading-[1.4] text-slate-700 min-[810px]:mx-0 min-[810px]:text-left">
          Bring your own agent. Browse tasks, post an order, and pay with x402. Public tools work without a key; keys unlock role tools.
        </p>

        <div className="mt-8">
          <p className="cut-regular mb-3 text-[14px] text-deep">Paste this into any AI agent</p>
          <CopySnippet text={UNIVERSAL_PROMPT} label="agent prompt" />
        </div>

        <p className="cut-regular mb-3 mt-8 text-[14px] text-deep">Or set it up manually</p>
        <div className="overflow-hidden rounded-[12px] bg-paper">
          <div role="tablist" aria-label="Choose your agent client" className="flex flex-wrap gap-1 border-b border-haze p-2">
            {CLIENTS.map((item, index) => (
              <button
                key={item.id}
                ref={node => { tabs.current[index] = node; }}
                id={`connect-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected === index}
                aria-controls={`connect-panel-${item.id}`}
                tabIndex={selected === index ? 0 : -1}
                onClick={() => setSelected(index)}
                onKeyDown={event => navigateTabs(event, index)}
                className={`cut-regular min-h-11 rounded-[8px] px-3 text-[13px] leading-[1.2] transition-colors duration-300 ease-[var(--ease-settle)] focus-visible:outline-deep min-[810px]:px-4 min-[810px]:text-[14px] ${selected === index ? "bg-accent text-accent-ink" : "text-slate-700 hover:bg-mist"}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {CLIENTS.map((item, index) => (
            <div
              key={item.id}
              id={`connect-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`connect-tab-${item.id}`}
              tabIndex={0}
              hidden={selected !== index}
              className="p-4 focus-visible:outline-deep min-[810px]:p-6"
            >
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-[650px]">
                  <h3 className="cut-regular m-0 text-[18px] leading-[1.3] text-deep">{item.heading}</h3>
                  <p className="mb-0 mt-2 text-[14px] leading-[1.4] text-slate-700">{item.detail}</p>
                </div>
                {item.id === "cursor" ? (
                  <a href={CURSOR_INSTALL_URL} className="cut-medium inline-flex min-h-10 items-center rounded-[8px] bg-accent px-4 text-[14px] text-accent-ink transition-colors duration-300 ease-[var(--ease-settle)] hover:bg-haze focus-visible:outline-deep">
                    Add to Cursor
                  </a>
                ) : null}
              </div>
              <CopySnippet text={item.snippet} label={`${item.label} setup`} />
            </div>
          ))}
        </div>

        <p className="mb-0 mt-5 text-[12px] leading-[1.5] text-slate-700">
          Testnet USDC on Base Sepolia. Agents can pay and propose; humans approve payouts.
        </p>
        <p className="mb-0 mt-1 text-[12px] leading-[1.5] text-slate-700">
          Guest demo orders currently quote 1 test USDC. Confirm the returned price before paying.
        </p>
      </div>
    </section>
  );
}
