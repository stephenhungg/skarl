# Product Context

## Grand thesis

Skarl turns everyday human skill into licensed, verified training data, with a finance agent that can pay contributors and keep accountable books on Solana.

The Kled-inspired premise is a marketplace for human data. Our engineering wedge is an evidence pipeline for narrated demonstrations and a real operational loop from funded work to delivery, liability, payout and reconciliation. Prior discussion establishes product inspiration; it does not establish Kled's current revenue, growth, defensibility or permission to copy its assets. Do not include unverified traction claims in the pitch.

## Narrow first customer and task

The demo buyer is an AI team acquiring short procedural demonstrations for assistive or embodied systems. The contributor records one harmless desktop task: **pick up the red cup, place it on the marked coaster and narrate the action**. Use a fixed camera, red and blue cups, one marked coaster, a 10–30 second duration and the same immutable rubric for the first demo. This makes temporal action, visible outcome, speech alignment and copy detection observable.

This is a test task, not evidence that the dataset already improves a robot or accessibility product. The longer-term benefit is paid participation in data production and better coverage of human procedures. Real-world impact still requires buyer validation, consented data and downstream evaluation.

## Core features

- Buyer defines an immutable task version, criteria, quota, per-sample price and allowed license; funds an order using x402 on Solana Devnet.
- Contributor sees scope and payment terms, consents, records video plus narration and uploads privately.
- Verifier independently extracts silent visual evidence and speech, tests their agreement, checks for copied footage and returns timestamps for every supported claim.
- Review view links each criterion to video or audio. Unobservable work receives correction or human review instead of a confident guess.
- Acceptance reserves funded quota. Delivery publishes a licensed manifest to the buyer. The finance system accrues contributor obligations and records the appropriate journal entries.
- Finance agent uses allowlisted typed tools to propose payouts/refunds, checks limits, requests an authorized approval when needed and reconciles chain observations against books.
- Operator dashboard shows funded amount, accepted/delivered samples, outstanding payables, payout status, refunds and complete audit history.

## User flows

### Buyer

1. Authenticate into a buyer organization; set sample count, price and task criteria.
2. Review the frozen task version and funding quote; authorize a Devnet USDC payment.
3. See `pending` while settlement is checked. `funded` requires a matching observed transfer, not merely a signed payload.
4. Watch submission progress and delivered count update from Convex queries.
5. Download only licensed accepted samples through authenticated access. Cancel unused work and track the approved refund.

### Contributor

1. Authenticate, connect/prove control of a payout address, read terms and consent.
2. Check camera/microphone preview and record a short demonstration. Narration supplies evidence, not instructions to the verifier.
3. Upload original media, attach its storage ID to the expected task version and receive a queued submission ID.
4. See timestamped correction requests or the acceptance outcome. Show amounts as pending obligations until an actual payout confirms.
5. View the transfer signature and amount once the payout is observed. A new payout address requires explicit re-verification and payment-policy checks.

### Operator / finance agent

1. Review a grounded report and budget state; apply a recorded human decision for ambiguous work.
2. Ask the agent to explain outstanding obligations and prepare a bounded payment batch.
3. An independent authorized approver approves exceptions or batches above policy thresholds; the requester cannot approve their own exception.
4. Execute only stored approved intents. Reconcile RPC results; retry observation, not blind transfers.
5. Inspect balanced journals, open liabilities, cash and a period report. An AI explanation is never the ledger itself.

## Explicit scope limits

One task family, one buyer order, one contributor wallet, one chain and a short consented clip are enough for the first complete loop. No token launch, trustless escrow, staking, contributor marketplace ranking, livestreaming, fine-tuning program or broad anti-deepfake claim is required. Image/video hashes prove byte integrity and help detect copies; they do not prove who recorded a scene or whether an action was ethically sourced.

See [demo](demo.md), [AI design](ai-verification.md) and [accounting](accounting.md).
