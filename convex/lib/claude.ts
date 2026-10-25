import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

/** Never persist provider bodies, credentials or SDK exception messages. */
export class ClaudeFailure extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}
export function createClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeFailure("anthropic_key_missing");
  return new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", maxRetries: 0, timeout: 30_000, logLevel: "off" });
}
export async function requestClaude(params: MessageCreateParamsNonStreaming, timeoutMs = 30_000) {
  if (timeoutMs <= 0) throw new ClaudeFailure("agent_deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = createClaudeClient();
    // The SDK fetch timeout ends at response headers. Bound body parsing as well.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new ClaudeFailure("claude_timeout")); controller.abort(); }, Math.min(30_000, timeoutMs));
    });
    const response = await Promise.race([client.messages.create(params, {
      timeout: Math.min(30_000, timeoutMs), signal: controller.signal,
    }), timeout]);
    if (!response || !Array.isArray(response.content)) throw new ClaudeFailure("claude_response_invalid");
    if (response.stop_reason === "refusal") throw new ClaudeFailure("claude_refusal");
    return response;
  } catch (error) {
    if (error instanceof ClaudeFailure) throw error;
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) throw new ClaudeFailure("claude_timeout");
    if (error instanceof Anthropic.APIError && error.status) throw new ClaudeFailure(`claude_http_${error.status}`);
    throw new ClaudeFailure("claude_request_failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
