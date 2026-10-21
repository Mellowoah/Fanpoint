"use client";
import type { AgentEvent } from "@/lib/agent/types";

type ErrorEvent = Extract<AgentEvent, { type: "error" }>;

const TITLES: Partial<Record<ErrorEvent["code"], string>> = {
  auth: "API key rejected", rate_limited: "Rate limited", timeout: "Timed out", network: "Connection problem",
  upstream: "Provider error", invalid_response: "Unexpected data", budget: "Call budget reached",
  config: "Configuration problem", forbidden: "Request type not enabled",
  invalid_request: "Check the form", incomplete: "Plan didn't arrive", agent: "The agent didn't finish", internal: "Something went wrong",
};

export const errorOf = (events: AgentEvent[]) => events.find((e): e is ErrorEvent => e.type === "error");

/** Clear, specific error state with a retry button (when retrying can help). */
export function ErrorPanel({ error, onRetry, context }: { error: ErrorEvent; onRetry?: () => void; context?: string }) {
  const who = error.provider === "qloo" ? "Qloo" : error.provider === "llm" ? "LLM" : undefined;
  return (
    <div role="alert" className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm grid gap-1.5">
      <div className="font-semibold text-red-300">{context ? `${context}: ` : ""}{TITLES[error.code] ?? "Error"}{who && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 align-middle">{who}</span>}</div>
      <div>{error.message}</div>
      {error.retryable && onRetry && <button onClick={onRetry} className="justify-self-start mt-1 px-3 py-1.5 rounded-md border border-red-400/60 hover:bg-red-500/20">Try again</button>}
    </div>
  );
}

/** Non-fatal problems (partial data). The plan is still shown. */
export function WarningList({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-sm">
      <div className="font-semibold text-amber-200 mb-1">Partial data</div>
      <ul className="list-disc pl-5 grid gap-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
    </div>
  );
}
