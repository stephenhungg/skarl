# Claude for robot-demonstration contributors

**Every claim has a witness.** Skarl is an autonomous settlement desk for
human-data companies. Independent evidence must agree before work can qualify;
agents explain and argue the case, deterministic code enforces the rules, and
humans review exceptions and approve payments.

## Community and problem

Our community is **student and gig contributors recording robot-training
demonstrations for labs**. A contributor films a task, uploads it and waits.
Rejection without a useful explanation means another unpaid recording attempt;
late or unexplained payment leaves the contributor unable to tell whether the
problem is their work, a review queue or settlement. Labs also need to distinguish
new work from duplicate recordings and maintain a defensible record of what they
owe.

The narrow job for Claude is to make those boundaries understandable. The
Contributor Coach turns the stored report into kind, specific guidance with
citations. A separate finance provider explains exact obligations and can propose
existing payables for independent approval. Neither role decides that a person
should be paid.

## What is implemented, and what works Monday

The backend provides two bounded integrations using `@anthropic-ai/sdk` 1.3.0
from Convex Node actions:

- `coach.explainOutcome` creates a persisted explanation for the contributor's
  own submission. It reads stored criterion statuses, evidence ranges and
  warnings; it does not ask Claude to judge the original recording again.
  The contributor query exposes guidance for the current report and outcome.
- `financeAgent.run` can select Claude or Gemini behind the same six typed tools
  and deterministic finance controls. The persisted run records its provider,
  model, tool results and terminal status for the controller.

The intended Monday workflow is one concrete support task: a robot-demonstration
contributor reads what the report found and receives a next step tied to the
recording. For example, **illustrative wording, not an observed Claude result**:
“At 0:04 the cup left the frame; if you re-record, keep the cup and coaster
visible.” The actual API supplies its timestamp from stored evidence, not from
model prose. This reduces the gap between a criterion result and an actionable
correction without granting the coach authority to change the result.

**Evidence status, October 25, 2026:** this addition is implemented with synthetic
provider tests. `ANTHROPIC_API_KEY` was absent from the local
`~/.config/skarl/anthropic.env` file and from the `dev:keen-marmot-986` Convex
environment when checked. No live Claude inference or Claude-assisted payment is
claimed. The deployment operator must deploy merged `origin/main` and configure
the key. The web/iOS coach UI and production authentication are separate
integration work; the current public demo identity selector is impersonable and
is not production authentication. This is a backend handoff, not a claim of a
production-ready contributor service.

## How Claude is constrained

The finance adapter maps the existing tools to Anthropic `input_schema` objects,
using `strict: true` and `additionalProperties: false`. Runtime validation still
checks every requested tool and argument before dispatch. `approve`, signing,
transfers, arbitrary HTTP and arbitrary Convex calls are never advertised.
An unexpected approval attempt reaches only the existing agent-refusal path;
unknown tools and malformed arguments produce persisted refusals. Claude receives
`tool_result` blocks, with `is_error: true` for refused operations. This follows
Anthropic's [strict tool schema format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use).

Finance requests use `tool_choice: {type: "auto"}`. There is no assistant prefill;
only actual returned assistant messages enter the conversation. Both integrations
request `output_config.effort: "low"`; the coach has no tools. The SDK transport
has a 30-second maximum request timeout and disables automatic retries. Finance
retains the existing two-minute run budget, tool-call cap, cumulative exact
micro-USDC proposal cap, idempotent request ID and persisted transcript format.
See Anthropic's [tool choice guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
and [effort configuration](https://platform.claude.com/docs/en/build-with-claude/effort).

The default model is `claude-sonnet-5-5`. `ANTHROPIC_MODEL` sets the shared
override; `ANTHROPIC_FINANCE_MODEL` can override finance independently.
`FINANCE_AGENT_PROVIDER` accepts `gemini` or `claude` and defaults to `gemini`.
A provider refusal (`stop_reason: "refusal"`) becomes a sanitized
`claude_refusal` failure; it is not interpreted as successful output.

## Where Claude could go wrong

| Failure | Boundary and remaining limitation |
| --- | --- |
| Fluent explanation invents an observation | The coach receives the stored report only. Output must reference an existing criterion and evidence index; timestamps and criterion statuses are attached by server code. Prose remains model-authored and can misdescribe evidence, so it stays advisory beside the report. |
| Narration or report text contains instructions | Raw narration and media are omitted from coach input. Remaining reasons/descriptions/warnings are explicitly untrusted data. The coach has no tools, and finance tools cannot accept roles, destinations, amounts or executable instructions from the model. Prompt instructions are an additional mitigation, not an authorization boundary. |
| Guidance promises payment or changes a verdict | The coach cannot mutate submissions, decisions, payables or approvals. Verdict/status fields and the payment caveat come from server code. Model prose has restrictive validation and fixed next-step wording; invalid output becomes unavailable. Language filters are not a proof of factual correctness. |
| Missing evidence is explained as a pass | Unobservable, incomplete/scaffold or warning-bearing evidence forces uncertainty. Advice cannot promote an incomplete report into acceptance. Human review remains available. |
| An old explanation appears after a rerun | Persistence binds the explanation to the source report and submission outcome; current-result reads and completion checks reject stale bindings. |
| A model tries to approve or exceed a limit | Only the shared allowlist is advertised; existing server role, tenant, amount, replay and approval rules remain authoritative. All money stays integer micro-USDC. |
| Provider refuses, fails or times out | Sanitized failure state is persisted; no fabricated coaching success or payment success is returned. Previously persisted finance tool results remain inspectable. |

The tests exercise synthetic refusals, malformed arguments, unexpected tools,
access boundaries and output validation. They demonstrate software boundaries,
not measured real-world coaching quality or model accuracy. A consented live
report, a real Claude response and contributor feedback are still needed before
claiming that the guidance is useful to this community in practice.

## Human setup and verification

No Convex deployment is performed by this change. The deployment operator deploys
merged `origin/main`, including the coach table and regenerated API, using the
project's normal deployment workflow.

Create a private local credential file without putting the key in shell history:

```sh
umask 077
mkdir -p "$HOME/.config/skarl"
touch "$HOME/.config/skarl/anthropic.env"
chmod 600 "$HOME/.config/skarl/anthropic.env"
${EDITOR:-vi} "$HOME/.config/skarl/anthropic.env"
```

In that editor, add `ANTHROPIC_API_KEY=<your real Anthropic API key>` and save.
Keep the file outside the repository. Then import it directly into the authorized
development deployment and choose the provider:

```sh
CONVEX_DEPLOYMENT=dev:keen-marmot-986 pnpm exec convex env set --from-file "$HOME/.config/skarl/anthropic.env"
CONVEX_DEPLOYMENT=dev:keen-marmot-986 pnpm exec convex env set ANTHROPIC_MODEL claude-sonnet-5-5
CONVEX_DEPLOYMENT=dev:keen-marmot-986 pnpm exec convex env set FINANCE_AGENT_PROVIDER claude
```

The environment-file import refuses conflicting existing values unless explicitly
overwritten. Do not print the file or run an environment listing with values.
The coach uses Claude regardless of the selected finance provider. Set
`FINANCE_AGENT_PROVIDER` back to `gemini` to restore Gemini finance calls.

After operator deployment, use a real owned submission with a stored report:

```sh
CONVEX_DEPLOYMENT=dev:keen-marmot-986 pnpm exec convex run coach:explainOutcome '{"demoIdentity":"contributor","submissionId":"<submission-id>"}'
```

Read the persisted result through the [dashboard and iOS API handoff](dashboard-api.md#claude-provider-and-contributor-coach).
For finance, invoke `financeAgent:run` with a new request ID and an explicitly
read-only prompt, then inspect `financeAgentData:runs`; a returned run ID alone
does not establish success. Record provider, model, failure code or completed
response, source report and elapsed time before changing the evidence label to
live. Never use a synthetic test transcript as evidence of live inference.
