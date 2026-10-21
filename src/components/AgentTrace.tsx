"use client";
import { useState } from "react";
import type { AgentEvent } from "@/lib/agent/types";

/** Live trace of the agent: steps, the model's reasoning notes, and every exact Qloo request it made. */
export default function AgentTrace({ events, title }: { events: AgentEvent[]; title: string }) {
  // Ranking tools (heatmap reads) are expanded by default so their exact Qloo requests are visible.
  const [toggled, setToggled] = useState<Set<number>>(new Set());
  const isOpen = (i: number, name: string) => toggled.has(i) !== ["scan_corridor", "compare_fan_geography"].includes(name);
  const flip = (i: number) => setToggled((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const steps = new Map<string, Extract<AgentEvent, { type: "step" }>>();
  for (const e of events) if (e.type === "step") steps.set(e.id, e);
  const totalCalls = events.reduce((n, e) => n + (e.type === "tool" ? e.qlooCalls.length : 0), 0);
  return (
    <div className="card bg-panel p-4 text-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">{title}</h3>
        {totalCalls > 0 && <span className="text-xs text-plain font-mono">{totalCalls} Qloo calls</span>}
      </div>
      <ol className="grid gap-1.5 mb-3">
        {[...steps.values()].map((s) => (
          <li key={s.id} className="flex gap-2 items-start">
            <span className={s.status === "done" ? "text-emerald-400" : s.status === "error" ? "text-red-400" : "text-accent-text animate-pulse"}>
              {s.status === "done" ? "✓" : s.status === "error" ? "✗" : "●"}
            </span>
            <span>{s.label}{s.detail && <span className="text-plain">: {s.detail}</span>}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-1 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed">
        {events.map((e, i) => {
          if (e.type === "thought") return <div key={i} className="text-plain italic">{e.text}</div>;
          if (e.type === "error") return <div key={i} className="text-red-400">error: {e.message}</div>;
          if (e.type !== "tool") return null;
          return (
            <div key={i}>
              <button onClick={() => flip(i)} className="text-left hover:text-accent-text">
                <span className="text-accent-text">{e.name}</span>({compact(e.args)}) <span className="text-plain">{e.summary}</span>
              </button>
              {isOpen(i, e.name) && (
                <div className="pl-3 border-l border-line my-1 grid gap-0.5">
                  {e.qlooCalls.map((c, j) => (
                    <div key={j} className="text-plain break-all">
                      <span className="text-emerald-400">GET</span> {c.endpoint}?{new URLSearchParams(c.params).toString()}
                      <span className="opacity-60"> · {c.status} · {c.resultCount} results · {c.ms}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function compact(a: unknown) {
  const s = JSON.stringify(a);
  return s.length > 70 ? s.slice(0, 70) + "…" : s;
}
