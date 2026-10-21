import { runAgent } from "@/lib/agent/run";
import { runPlainFill } from "@/lib/agent/plain";
import { readPlanRequest } from "@/lib/api/plan-request";

/** POST /api/plan -> NDJSON stream of AgentEvents (one JSON object per line). Errors before streaming are JSON with a 4xx status. */
export async function POST(request: Request) {
  const parsed = await readPlanRequest(request);
  if (!parsed.ok) return Response.json(parsed.payload, { status: parsed.status });
  const { mode, ...req } = parsed.body;
  const events = req.task === "fill" && mode === "plain" ? runPlainFill(req) : runAgent(req);
  const enc = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      // runAgent / runPlainFill convert their own failures into error events; this catch is a last resort.
      try {
        for await (const ev of events) {
          if (cancelled) return; // client went away mid-run: nothing left to write to
          ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
        }
      } catch (e) {
        if (cancelled) return;
        console.error("[routed] stream failed", e);
        ctrl.enqueue(enc.encode(JSON.stringify({ type: "error", code: "internal", message: "The plan stream failed unexpectedly. Try again.", retryable: true }) + "\n"));
      }
      ctrl.close();
    },
    cancel() { cancelled = true; void events.return(undefined); }, // client went away: stop the agent (and its Qloo calls)
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
