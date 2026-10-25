import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { authorizeFinanceTool, capFinanceToolResult, executeFinanceReadTool, type FinanceToolCall, type FinanceToolScope } from "./financeToolRegistry";

const readRef = makeFunctionReference<"query", { orderId: Id<"orders">; tool: string; argsJson: string }, string>("financeToolRead:read");

/** All three entrypoints use this dispatcher. A caller cannot acquire a mutation
 * callback by naming a tool; only the authorized run installs one. */
export async function dispatchFinanceTool(ctx: Pick<ActionCtx, "runQuery">, call: FinanceToolCall,
  scope: FinanceToolScope, propose?: (call: FinanceToolCall) => Promise<unknown>) {
  if (["approve", "approvePayment"].includes(call.name)) {
    if (scope.role === "run" && propose) return propose(call); // refusal audit only
    return { ok: false, code: scope.role === "chat" ? "read_only_chat" : "advisory_read_only" };
  }
  // Keep read-only refusal codes stable while enforcing the registry's role gate.
  if (scope.role !== "run" && ["proposePaymentBatch", "requestApproval"].includes(call.name)) {
    return { ok: false, code: scope.role === "chat" ? "read_only_chat" : "advisory_read_only" };
  }
  if (call.name === "taxSummary" && call.arguments.orderId !== null && call.arguments.orderId !== scope.orderId) return { ok: false, code: "not_found" };
  const tool = authorizeFinanceTool(call, scope);
  if (tool.readOnly) return executeFinanceReadTool(call, scope, input => ctx.runQuery(readRef, { ...input, orderId: input.orderId as Id<"orders"> }));
  if (!propose || scope.role !== "run") throw new Error("tool_not_allowed");
  return capFinanceToolResult(call.name, await propose(call));
}
