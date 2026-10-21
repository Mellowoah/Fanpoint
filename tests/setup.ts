import { beforeEach, vi } from "vitest";
// Server-side error logging is expected in failure-path tests; keep the output readable.
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
