import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // `server-only` throws outside a React Server environment; tests run plain Node.
      "server-only": r("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    // Keys must never be needed: tests always use mocks or injected fake fetch.
    env: { QLOO_API_KEY: "", LLM_API_KEY: "", ROUTED_FORCE_MOCK: "1" },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // Fixtures are data; agent/types.ts and llm/types.ts are type-only (no runtime code).
      exclude: ["src/lib/qloo/fixtures/**", "src/lib/agent/types.ts", "src/lib/llm/types.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
});
