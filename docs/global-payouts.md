# Global payouts: anyone with a phone can earn

**Positioning:** Robot labs need human demonstrations from every kind of home, kitchen and workshop on earth, not just from a few US cities. Skarl lets anyone with a smartphone record a task, have it verified by AI, and get paid in a dollar stablecoin (USDC) within minutes of human approval, with no bank account, no PayPal country list and no minimum payout threshold.

This is a diversity argument for labs (environments, objects and hands from everywhere) and an earning argument for contributors (dollar-denominated pay, explained verdicts, fast settlement).

## Why stablecoin payouts (cited)

- **Cross-border payments are expensive.** Sending $200 costs **6.36%** on average worldwide, and **8.46%** into Sub-Saharan Africa (World Bank, Remittance Prices Worldwide, Q3 2025): https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf
- **Banks miss many people with phones.** About **1.3 billion** adults remain unbanked; roughly **900 million** of them own a mobile phone and about **530 million** have a smartphone (World Bank Global Findex 2025, as summarized by BIIA): https://www.biia.com/financial-inclusion-at-record-high-but-1-3-billion-still-unbanked-world-bank-global-findex-2025-report/ · source: https://www.worldbank.org/en/publication/globalfindex
- **The demand is already there.** India ranked **#1** in the Chainalysis 2025 Global Crypto Adoption Index; Sub-Saharan Africa's on-chain activity grew **52%** year over year, with Nigeria receiving **$92.1B**, driven by remittances, dollar access via stablecoins and everyday payments: https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/ · https://www.chainalysis.com/blog/subsaharan-africa-crypto-adoption-2025/
- **Contributors on existing platforms complain about payouts.** Kled App Store reviews describe payouts stuck in "Pending" for days and tiny per-item pay (see `docs/market.md` once merged).

## What Skarl already does for this

| Need | Skarl |
| --- | --- |
| Get paid without a bank | USDC to any wallet address the contributor verifies (signed SIWE challenge). Base Sepolia today; Solana rail exists for funding. |
| Small, fast payouts | Exact micro-USDC amounts; no platform minimum; settlement observed on-chain and reconciled in minutes. |
| Trust that pay is fair | Claude coach explains every verdict with timestamps; contributor earnings view shows status and the payout transaction link. |
| Safety for the platform | Human approval on every payout; CDP policy caps; four-way reconciliation; no agent can approve. |
| Works on a phone | iOS app with camera, narration, motion sensors and liveness words; web recorder too. |

## Honest limits (say these if asked)

- **Testnet only.** All payouts are Base Sepolia test USDC. No real money has moved.
- **Cashing out is the contributor's step.** Converting USDC to local currency depends on local exchanges, P2P markets or mobile-money off-ramps, which vary by country.
- **Regulation and tax vary.** For example, India taxes crypto gains and applies TDS on transfers; Nigeria's rules have shifted. A production launch needs per-country compliance, KYC for payouts above thresholds, and sanctions screening (the CDP facilitator already screens x402 payments).
- **Crypto should be one option, not the only one.** Roadmap: fiat payout rails (bank transfer, mobile money, PayPal) alongside USDC, chosen by the contributor.
- **Fair-pay framing.** Rates must be set per task and disclosed up front; global reach must not become a race to the bottom. Skarl's rubric, explained verdicts and transparent ledger are what make the pay auditable.

## Pitch line

> "A robot learns from whoever recorded the data. Skarl lets anyone with a phone, in Lagos, Pune or Oakland, record a task, see exactly why it passed, and get paid in dollars within minutes. No bank account, no payout minimum, and every dollar has a witness."
