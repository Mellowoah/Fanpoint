#!/usr/bin/env node
/**
 * Verifies that API keys cannot reach the browser. Run after `next build`.
 *
 * 1. Client bundles (.next/static) must not contain markers that only exist in server modules: the Qloo auth
 *    header, the Qloo host, the LLM endpoint path and auth scheme, the env-reading code in config.ts.
 *    Their presence would mean config / http-client / openai-compatible was pulled into a client component.
 *    (The env var *names* do appear in the client on purpose: the mock-mode banner tells the user what to set.)
 * 2. If the build ran with canary keys (CI sets QLOO_API_KEY / LLM_API_KEY to the values below), the canary
 *    values must not appear anywhere in .next: keys are read at request time, never inlined at build time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const NEXT = join(ROOT, ".next");
const CANARIES = ["routed-canary-qloo-key", "routed-canary-llm-key"];
// The last marker is from road-matrix.json (server-only: ~800 KB the browser never needs).
const CLIENT_FORBIDDEN = ["X-Api-Key", "hackathon.api.qloo.com", "/chat/completions", "Bearer ", "ROUTED_FORCE_MOCK", "api.openai.com", "generativelanguage.googleapis.com", "row = origin, column = destination"];

function* files(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (e !== "cache") yield* files(p); } else if (s.size < 20_000_000) yield p;
  }
}

const problems = [];
let clientFiles = 0, allFiles = 0;
for (const f of files(join(NEXT, "static"))) {
  if (!/\.(js|mjs|css|html|json|txt)$/.test(f)) continue;
  clientFiles++;
  const text = readFileSync(f, "utf8");
  for (const needle of CLIENT_FORBIDDEN) if (text.includes(needle)) problems.push(`client bundle ${f.slice(ROOT.length)} contains "${needle}"`);
}
const canaryBuild = CANARIES.includes(process.env.QLOO_API_KEY ?? "") || CANARIES.includes(process.env.LLM_API_KEY ?? "");
for (const f of files(NEXT)) {
  allFiles++;
  const text = readFileSync(f, "latin1");
  for (const c of CANARIES) if (text.includes(c)) problems.push(`${f.slice(ROOT.length)} contains canary key "${c}"`);
}

if (!clientFiles) { console.error("check-bundle: no client bundle found. Run `npm run build` first."); process.exit(2); }
if (problems.length) { console.error(`check-bundle: FAILED\n  ${problems.join("\n  ")}`); process.exit(1); }
console.log(`check-bundle: OK. ${clientFiles} client files free of server-only identifiers; ${allFiles} build files free of key values${canaryBuild ? " (canary build)" : " (run with canary keys for the full check)"}.`);
