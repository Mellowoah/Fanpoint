import { isProviderError } from "../net/errors";
import type { AgentEvent } from "./types";

type ErrorEvent = Extract<AgentEvent, { type: "error" }>;

/** Convert anything thrown during a run into a user-facing error event. Internal details are logged, not shown. */
export function toErrorEvent(e: unknown): ErrorEvent {
  if (isProviderError(e)) {
    console.error(`[routed] ${e.message}`);
    return { type: "error", code: e.code, provider: e.provider, message: e.userMessage, retryable: e.retryable || e.code === "rate_limited" };
  }
  console.error("[routed] internal error", e);
  return { type: "error", code: "internal", message: "Something went wrong inside Routed. Try again; if it repeats, check the server log.", retryable: true };
}

export const agentError = (message: string, code: ErrorEvent["code"] = "agent", retryable = true): ErrorEvent => ({ type: "error", code, message, retryable });
