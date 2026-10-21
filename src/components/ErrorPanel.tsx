"use client";
import type { AgentEvent } from "@/lib/agent/types";

type ErrorEvent = Extract<AgentEvent, { type: "error" }>;

const TITLES: Partial<Record<ErrorEvent["code"], string>> = {
  auth: "API key rejected", rate_limited: "Rate limited", timeout: "Timed out", network: "Connection problem",
  upstream: "Provider error", invalid_response: "Unexpected data", budget: "Call budget reached",
  config: "Configuration problem", forbidden: "Request type not enabled",
  invalid_request: "Check the form", incomplete: "Plan didn't arrive", agent: "The agent didn't finish", internal: "Something went wrong",
};
/** One plain-language line on what to do next, per error kind. */
const NEXT: Partial<Record<ErrorEvent["code"], string>> = {
  rate_limited: "The provider asked Routed to slow down. Wait a few seconds, then try again.",
  timeout: "The provider took too long. Trying again usually works.",
  network: "Check your connection, then try again.",
  upstream: "The provider had a hiccup. Trying again usually works.",
  incomplete: "The stream closed early. Trying again usually works.",
  invalid_request: "Fix the highlighted fields above and run it again.",
};

export const errorOf = (events: AgentEvent[]) => events.find((e): e is ErrorEvent => e.type === "error");

/** Clear, specific error state with a retry button (when retrying can help). */
export function ErrorPanel({ error, onRetry, context }: { error: ErrorEvent; onRetry?: () => void; context?: string }) {
  const who = error.provider === "qloo" ? "Qloo" : error.provider === "llm" ? "LLM" : undefined;
  const next = NEXT[error.code];
  return (
    <div role="alert" className="rounded-2xl border border-red-500/35 bg-red-500/[0.07] p-4 sm:p-5 text-sm flex gap-3">
      <span aria-hidden className="mt-0.5 size-7 shrink-0 rounded-full bg-red-500/15 text-red-300 grid place-items-center font-bold">!</span>
      <div className="grid gap-1.5 min-w-0">
        <div className="font-semibold text-red-200">{context ? `${context}: ` : ""}{TITLES[error.code] ?? "Error"}{who && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/20 align-middle">{who}</span>}</div>
        <div className="text-foreground/90">{error.message}</div>
        {next && <div className="text-xs text-plain">{next}</div>}
        {error.retryable && onRetry && <button onClick={onRetry} className="btn btn-secondary btn-sm justify-self-start mt-1">Try again</button>}
      </div>
    </div>
  );
}

/** Non-fatal problems (partial data). The plan is still shown. */
export function WarningList({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-4 text-sm">
      <div className="font-semibold text-amber-200 mb-1">Partial data</div>
      <ul className="list-disc pl-5 grid gap-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
    </div>
  );
}
