/**
 * Decide whether a Qloo base URL is safe to send the API key to.
 *
 * The key is an event-issued, individually attributable credential (Qloo hackathon kit, docs/API_ACCESS.md), so
 * a typo or a malicious env value must not ship it to some other host. Same policy as Qloo's own harness client:
 *   - https only (plain http only for a loopback test server);
 *   - no userinfo, query string or fragment in the base URL;
 *   - the host must be a known Qloo API host, unless the exact URL is also set in QLOO_TRUSTED_BASE_URL.
 * Known hosts: hackathon.api.qloo.com (where the Qloo hackathon developer guide says hackathon keys work) and
 * api.qloo.com (the harness default and production host).
 */
export const QLOO_HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";
export const KNOWN_QLOO_HOSTS: ReadonlySet<string> = new Set(["hackathon.api.qloo.com", "api.qloo.com"]);

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const comparable = (u: URL): string => `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;

export function checkQlooBaseUrl(raw: string, trusted?: string): BaseUrlCheck {
  return checkKeyedBaseUrl(raw, KNOWN_QLOO_HOSTS, trusted, "a known Qloo API host", "QLOO_TRUSTED_BASE_URL");
}

/**
 * Shared policy for any base URL that receives an API key: https (http only for loopback), no userinfo, query or
 * fragment, and a host from `known` on the default port, unless `trusted` names exactly this URL. Each key has its
 * own `known` list, so a host allowed for one key (e.g. Google's for LLM_API_KEY) never receives another key.
 */
export function checkKeyedBaseUrl(raw: string, known: ReadonlySet<string>, trusted: string | undefined, what: string, trustedEnv: string): BaseUrlCheck {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "not a valid URL" }; }
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return { ok: false, reason: "must use https (http only for localhost)" };
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: "must not contain credentials, a query string or a fragment" };
  const url = comparable(u);
  if (u.protocol === "https:" && known.has(u.hostname) && !u.port) return { ok: true, url };
  if (trusted) {
    try { if (comparable(new URL(trusted)) === url) return { ok: true, url }; } catch { /* fall through */ }
  }
  return { ok: false, reason: `host ${u.host} is not ${what}; set ${trustedEnv} to exactly this URL to allow it` };
}
