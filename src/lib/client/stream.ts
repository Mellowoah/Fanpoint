/**
 * Browser side of POST /api/plan: reads the NDJSON event stream and turns every failure mode
 * (network down, 4xx validation errors, malformed lines, a stream that ends without a result, a hung server)
 * into a typed error event, so the UI always has something specific to show.
 */
import type { AgentEvent } from "../agent/types";

type ErrorEvent = Extract<AgentEvent, { type: "error" }>;
const err = (code: ErrorEvent["code"], message: string, retryable = true): ErrorEvent => ({ type: "error", code, message, retryable });

/** Parse one NDJSON line into an AgentEvent, or undefined if it isn't one. */
export function parseEventLine(line: string): AgentEvent | undefined {
  try {
    const v: unknown = JSON.parse(line);
    if (typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string") return v as AgentEvent;
  } catch { /* not JSON */ }
  return undefined;
}

/** Human message for a non-2xx response from /api/plan (validation errors carry `error.message`). */
export async function httpErrorEvent(res: Response): Promise<ErrorEvent> {
  let message = "";
  let issues: { path: string; message: string }[] = [];
  try {
    const j = (await res.json()) as { error?: { message?: unknown; issues?: unknown } };
    if (typeof j.error?.message === "string") message = j.error.message;
    if (Array.isArray(j.error?.issues)) issues = j.error.issues.filter((i): i is { path: string; message: string } => typeof i?.path === "string" && typeof i?.message === "string");
  } catch { /* non-JSON body */ }
  if (res.status === 400) {
    if (!issues.length && message) issues = message.split("; ").map((part) => { const m = /^([\w.]+): (.+)$/.exec(part); return m ? { path: m[1]!, message: m[2]! } : { path: "", message: part }; });
    const list = issues.map(friendlyIssue);
    return err("invalid_request", list.length ? `A few details need a fix: ${list.join("; ")}.` : "Something in the form isn't quite right. Check the fields and try again.", false);
  }
  if (res.status === 413 || res.status === 415) return err("invalid_request", message || `Request rejected (HTTP ${res.status}).`, false);
  return err("internal", `The server answered HTTP ${res.status}${message ? `: ${message}` : ""}. Try again.`);
}

const FIELD: Record<string, string> = { artist: "Artist", partner: "Co-headliner", anchors: "Dates", maxDriveMi: "Max drive per day", minAffinity: "Fan-heat floor", rules: "Touring rules" };
/** "anchors.0.city: pick a city…" -> "Stop 1 city: pick a city…"; "artist: required" -> "Artist: enter a name". */
export function friendlyIssue(i: { path: string; message: string }): string {
  const [head = "", idx, leaf] = i.path.split(".");
  if (head === "artist" && i.message === "required") return "Artist: enter an artist name";
  if (head === "anchors" && idx !== undefined && /^\d+$/.test(idx)) return `Stop ${Number(idx) + 1}${leaf ? ` ${leaf}` : ""}: ${i.message}`;
  if (!head) return i.message;
  const label = FIELD[head] ?? i.path;
  return `${label}${head === "rules" && idx ? ` (${idx})` : ""}: ${i.message}`;
}

export interface StreamOptions { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal }

export async function streamPlan(body: object, onEvent: (e: AgentEvent) => void, opts: StreamOptions = {}): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  let terminal = false; // saw a result or an error
  const emit = (e: AgentEvent) => { if (e.type === "result" || e.type === "error") terminal = true; onEvent(e); };
  try {
    const res = await (opts.fetchImpl ?? fetch)("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok || !res.body) { emit(await httpErrorEvent(res)); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let bad = 0;
    const take = (line: string) => { if (!line.trim()) return; const e = parseEventLine(line); if (e) emit(e); else bad++; };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(take);
    }
    take(buf + dec.decode());
    if (!terminal) emit(err("incomplete", bad ? "The server sent data Fanpoint could not read, and no plan arrived. Try again." : "The connection closed before a plan arrived. Try again."));
  } catch {
    if (opts.signal?.aborted) return; // the user cancelled: not an error
    emit(ctrl.signal.aborted ? err("timeout", "No plan after 3 minutes; the request was stopped. Try again.") : err("network", "Could not reach the Fanpoint server. Check your connection and try again."));
  } finally {
    clearTimeout(timer);
  }
}
