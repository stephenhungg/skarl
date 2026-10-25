# Market: Task-Verified Demonstrations With a Defensible Receipt

Research snapshot: October 2026; summarized October 25, 2026. This is desk research, not customer discovery. Prices are quoted offers or reported estimates, not Skarl revenue, realized transaction prices or comparable units of quality. Vendor sources are marked below. Product implementation and live proof belong in [status](status.md); this document does not establish either.

## The Need

Human demonstration data has a real buyer, but raw hours are not the whole product. Forbes reports that Figure plans to spend **$1 billion on data and compute over the following 12 months**, and had paid contributors $15 million through Index. That is Figure's stated plan, not an estimate of the addressable market for Skarl. [Forbes, August 26, 2026](https://www.forbes.com/sites/johnkoetsier/2026/08/26/figure-launches-gig-platform-to-get-humans-to-do-work-to-train-robots-will-spend-1-billion/).

The research example is substantial: EgoScale uses **20,854 hours** of egocentric human video with hand, wrist and camera-motion supervision. It is evidence that relevant human video can help robot learning; it does not establish that Skarl's short red-cup task improves a robot. [EgoScale paper](https://arxiv.org/html/2602.16710v1).

Flikforge says buyers discard approximately **90% of bulk pretraining footage for a specific robotic training task** because it is redundant, unlabeled, sensor-misaligned or irrelevant. It also sells the curation and rights-management services it recommends. Treat this as a **vendor-reported claim**, not an independently measured industry-wide discard rate. Forbes links Flikforge for pricing estimates; its article does not independently establish this 90% figure. [Flikforge, vendor](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/).

Contributors need an explanation and a payment receipt as much as buyers need a quality receipt. MIT Technology Review reports uncertainty about how workers' footage is used, stored and shared, alongside AI-plus-human acceptance decisions and deletion questions. The article could not be independently re-opened during this documentation pass. [MIT Technology Review, April 1, 2026](https://www.technologyreview.com/2026/04/01/1134863/humanoid-data-training-gig-economy-2026-breakthrough-technology/).

The research also identifies Kled App Store reviews describing pending payouts and unclear upload guidance. Reviews are individual complaints, not a representative payout-time study or evidence of fraud. [Kled App Store reviews](https://apps.apple.com/us/app/kled/id6752585718?see-all=reviews&platform=iphone).

## Price Signals

These tiers mix capture costs, supplier estimates and retail listings. They cannot justify a single market-average price or a promised contributor wage.

| Tier | Reported price | Source and limitation |
| --- | --- | --- |
| Bulk egocentric video | $2–5 per hour | [Flikforge, vendor estimate](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/); also cited by [Forbes](https://www.forbes.com/sites/johnkoetsier/2026/08/26/figure-launches-gig-platform-to-get-humans-to-do-work-to-train-robots-will-spend-1-billion/) |
| Teleoperation | $50–200 per hour | [Flikforge, vendor estimate](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/), repeated by [Forbes](https://www.forbes.com/sites/johnkoetsier/2026/08/26/figure-launches-gig-platform-to-get-humans-to-do-work-to-train-robots-will-spend-1-billion/) |
| Raw capture / annotated capture | $15–22 / $30–40 per hour | [DexSet, vendor production benchmarks](https://dexset.ai/blogs/egocentric-data-collection-robotics/); annotation includes hand pose, object tracks and temporal segmentation |
| Curated egocentric listings | $90 unlabelled 1080p; $180 with language instructions; $225 with upper-body IMU | [Robotics Center, vendor listings](https://www.roboticscenter.ai/marketplace); recorded-hour prices, 10-hour minimum; the IMU listing advertises LeRobot v2 / MCAP |
| Contributor work | Micro1 $25–50 per hour; Encord up to $150 for technical tasks | [Business Insider](https://www.businessinsider.com/ai-startups-robotics-pay-film-chores-encord-micro1-scale-2025-10), reporting company statements; not guaranteed earnings |

## Where Skarl Fits

The customer hypothesis is a small human-data operator collecting **task-targeted demonstrations or private evaluation episodes**. Skarl's wedge is the settlement desk: connect frozen collection terms, timestamped verification evidence, consent provenance and an exact contributor obligation. It must demonstrate that this makes review and disputes easier before claiming commercial demand or a price premium.

| Gap | Skarl's proposed response | Proof still needed |
| --- | --- | --- |
| Unexplained rejection | Show the stored verdict, criterion-level evidence and timestamps, with a coach explanation grounded in that record | Contributor comprehension and correction success in a consented pilot |
| Opaque or slow pay | Show the payable, approval/settlement state, observed transfer link and measured time to payout | A completed live accepted-work payout; no speed guarantee |
| Missing chain of title | Attach consent-record reference, license version/scope, consent time, pseudonymous contributor hash, source hash, attestation, liveness and revocation state per sample | Legal review, verified identity/authority and downstream enforcement; an attestation proves a recorded commitment, not lawful ownership |
| Irrelevant or repeated footage | Buyer-defined rubrics, timestamped observations and copy evidence | Measured false acceptance and copy-detection limits on consented human clips |
| Private evaluation coverage | Collect specific long-tail tasks and environments against a buyer brief | A buyer willing to pay and an enforceable exclusivity/access policy; private held-out sales are a hypothesis |

Rights documentation is a procurement need, not a new differentiator by itself. Flikforge and ipto.ai already market consent trails and machine-readable rights. BIPA/GDPR handling and EU AI Act Article 10 data governance remain issues for production review. Skarl does **not** claim BIPA, GDPR or EU AI Act compliance, automatic bystander clearance, or a complete biometric-consent workflow. [Flikforge, vendor](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/), [ipto.ai, vendor](https://ipto.ai/data/robotics/).

## Honest Misalignments and Roadmap

1. **Short task clips are a narrow wedge.** The current red-cup demonstration is not a large, varied pretraining corpus. Start with a specific coverage gap or evaluation need; measure downstream usefulness before expanding the claim.
2. **Video and phone IMU are not action labels.** Skarl does not currently deliver hand pose, depth or full six-degree-of-freedom camera pose. Prioritize calibrated hand/wrist pose and object tracks, then depth and ARKit camera pose on supported hardware, with synchronization/error measurements. Existing phone attitude is only partial orientation evidence; it is not full camera pose. [EgoScale](https://arxiv.org/html/2602.16710v1), [DexSet, vendor](https://dexset.ai/blogs/egocentric-data-collection-robotics/), [current sensor limits](mobile.md).
3. **A handheld phone is not a head-mounted viewpoint.** Describe current capture as task-verified. A head-mount collection protocol, camera calibration and bystander/privacy review are roadmap work before promising egocentric robot-training capture. [Flikforge, vendor](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/).
4. **A custom manifest is not training interoperability.** Delivering JSONL does not establish LeRobot/RLDS compatibility. Validate an adapter against an actual buyer training pipeline before advertising support. [Robotics Center listings, vendor](https://www.roboticscenter.ai/marketplace).
5. **USDC adds contributor friction.** Base Sepolia is the current test payout rail. Fiat payout options and a measured off-ramp experience belong on the roadmap; the Nessie mock bank is not a fiat payout integration. No unverified competitor payout-option claim is treated as fact.
6. **The premium and agent-buyer stories remain unproven.** Verification and rights work must earn a premium over bulk video. x402 is an implemented purchase mechanism, not evidence that autonomous agents demand these samples. Interview operators and contributors, complete a consented pilot and measure review time, disputes, payout latency and useful delivered episodes.

Reddit and snippet-only earnings/deletion claims remain **unverified** and are excluded from pitch facts. Vendor claims about market gaps motivate tests; they do not substitute for Skarl customer validation.
