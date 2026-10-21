import "server-only";
import { getConfig } from "../config";
import { HttpQlooClient } from "./http-client";
import { MockQlooClient } from "./mock-client";
import type { QlooClient } from "./types";

/** Factory: live client when QLOO_API_KEY is set, otherwise clearly-labeled mock fixtures. */
export function createQlooClient(): QlooClient {
  const c = getConfig().qloo;
  return c.mode === "live" && c.apiKey ? new HttpQlooClient(c.apiKey, c.baseUrl, { trustedBaseUrl: c.trustedBaseUrl }) : new MockQlooClient();
}
