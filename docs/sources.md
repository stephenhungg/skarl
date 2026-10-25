# Research Sources

Checked October 24, 2026; payment and sponsor sources rechecked October 25 after the move to Base Sepolia. Primary sources below underpin the design; documentation and packages can change. Version checks are observations from this date, not guarantees about future compatibility. No private chat/email evidence is required to use this repository.

## Event and sponsor sources

- [Cal Hacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/): **authoritative** prize list, deadline (Oct 25, 12:00 PM EDT / 9:00 AM PDT) and rules.
- [Hyphenate track brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit): official brief.
- [Coinbase CalHacks brief](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view): the Payment Agents and Trading Agents tracks, judging, submission contents and eligibility terms.
- [Hive prize cards](https://hive.hackberkeley.org/prizes): secondary; it needs browser rendering.

## Platform and model references

- [Convex atomicity and concurrency](https://docs.convex.dev/database/advanced/occ)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex scheduling guarantees](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex uploads](https://docs.convex.dev/file-storage/upload-files)
- [Convex file access](https://docs.convex.dev/file-storage/serve-files)
- [Convex data types](https://docs.convex.dev/database/types)
- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex Workpool](https://github.com/get-convex/workpool)
- [Convex Workflow](https://github.com/get-convex/workflow)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models): model listings and capabilities do not establish usable quota for the team's key.
- [Gemini 3.8 Flash specifications](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): current configurable video/finance default and model used in the recorded generated-media smoke and finance-loop runs.
- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Meta SSCD implementation and weights](https://github.com/facebookresearch/sscd-copy-detection)
- [SSCD paper](https://arxiv.org/abs/2202.10261)
- [Meta video fingerprint alternatives](https://github.com/facebook/ThreatExchange)
- [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- [Qwen3-Omni requirements](https://github.com/QwenLM/Qwen3-Omni#minimum-gpu-memory-requirements)
- [Canonical x402 implementation](https://github.com/x402-foundation/x402)
- [x402 Next.js adapter](https://github.com/x402-foundation/x402/blob/main/typescript/packages/http/next/src/index.ts)
- [CDP x402 examples and scheme matrix](https://github.com/coinbase/cdp-sdk/blob/main/examples/typescript/x402/README.md)
- [x402 payment identifier extension](https://github.com/x402-foundation/x402/tree/main/typescript/packages/extensions/src/payment-identifier)
- [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator)
- [Coinbase retail MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/coinbase-mcp)
- [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp)
- [Coinbase agent tool guide](https://docs.cdp.coinbase.com/coinbase-for-agents/skill)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Canonical exact EVM payment scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)
- [Base Sepolia explorer](https://sepolia.basescan.org/)
- [IFRS principal-versus-agent discussion](https://www.ifrs.org/news-and-events/updates/ifric/2021/ifric-update-november-2021/)
- [Browser camera and microphone requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MediaRecorder codec capability checks](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [MediaRecorder timing caveats](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel June 2026 duration update](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)
- [Modal asynchronous jobs](https://modal.com/docs/guide/job-queue)
- [Cartesia batch transcription example](https://www.cartesia.ai/learn/python-speech-to-text)

## Version observations

| Package | Observed version / constraint |
| --- | --- |
| Next.js | `16.4.3`; installed and locked |
| React / React DOM | `19.3.1`; installed and locked |
| Convex | `1.48.0`; installed and locked |
| x402 core / fetch / EVM | `2.28.0`; `@x402/evm` depends on `viem ^2.48.11` |
| x402 Next | `2.28.0`; peers Next.js `>=16.2.6` and `@x402/paywall ^2.28.0` (which peers React 19) |

Install the x402 packages together at one pinned version and typecheck in hour 0–1 of the plan. Production model weights and ML wheels need their own hardware-specific lock/checksum records once implemented.

## Research limits

Current configurable defaults remain `gemini-3.8-flash` for video/finance and
`gemini-3.5-transcribe` for audio. Billing is enabled. The team's latest
Interactions probes returned correct HTTP 200 responses for 3.8 Flash in about
2.1 seconds, 4 Argon in 3.0 seconds and 3.6 Flash in 1.4 seconds. Earlier
free-tier stalls, Flash 503 responses and Argon zero-quota errors are historical
and no longer current blockers. These are session observations, not claims made
by the model documentation or a human-demonstration benchmark. Historical 3.8
measurements retain their original model attribution. See
[model configuration](ai-verification.md#models-and-configuration).

Sponsor briefs are requirements, not a prediction of winning. A model capability page is not a benchmark of Skarl. The project has no measured user demand, inference accuracy, robot improvement or production economics yet. Only claim measured results after the evaluation protocol has actually run. Kled is product inspiration from the team discussion; no unsourced traction claims are included.
