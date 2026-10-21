# Deploying Routed (always-on, Docker)

Routed runs as **one long-running Node server** in a Docker container. It is not built for a serverless host. Qloo's hackathon kit says serverless functions are not a supported route (README, "Qloo hackathon kit"). The rate limiter and the 6 h cache are also per process, and they only work if the process stays up.

What's in the repo:

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build → Next.js `output: "standalone"` server on `node:22-bookworm-slim`. Runs as the unprivileged `node` user, with a `HEALTHCHECK` on `/api/health`. No secrets at build time. |
| `.dockerignore` | Keeps `.env*`, `.git`, `node_modules`, `.next`, coverage and screenshots out of the build context. |
| `render.yaml` | Render Blueprint: one Docker web service, `plan: free`, health check `/api/health`, deploys only after CI passes. |
| `railway.json` | The same setup for Railway (Dockerfile builder, health check, no sleeping). |
| `src/app/api/health/route.ts` | `GET /api/health` → `{"ok":true,"modes":{"qloo":"mock"|"live","llm":"mock"|"live"}}`. It never shows keys. |

## Costs (checked 2026-10-19, 8:17 PM ET)

Source: [render.com/pricing](https://render.com/pricing) and [render.com/docs/free](https://render.com/docs/free), both fetched on 2026-10-19.

| Option | Price | Catch |
|---|---|---|
| Render **Hobby workspace** + **Free** web service (`free`, 0.1 CPU / 512 MB) | **$0** | "Render spins down a Free web service that goes 15 minutes without receiving any inbound traffic". Spinning back up "takes about one minute". Render also "might restart a Free web service at any time" and says not to use Free for production. Each workspace gets 750 free instance hours a month. |
| Render Hobby + **`0.5c-512mb`** (0.5 CPU / 512 MB, the cheapest always-on plan) | **$7/month**, "prorated to the second" | Needs a card. Render runs a $1 check charge and refunds it. |
| Render bandwidth | 5 GB/month included on Hobby, then $0.15/GB | Free services are suspended for the rest of the month if you go over without a payment method. |
| Render build minutes | 500/month included on Hobby | Each deploy is one Docker build. |
| Railway (alternative), [railway.com/pricing](https://railway.com/pricing) | Free: 30-day trial with $5 of credits, then $1/month. Hobby: $5 minimum usage | Usage-based; `railway.json` sets `sleepApplication: false`. |

**Recommendation `[assumption: judges may open the link at any hour, Nov 2–16]`:** deploy on **Free** now, at $0, to get the URL and test it. Before submitting, switch the service to **`0.5c-512mb`** for the judging window, so no judge waits a minute on a cold start. Oct 28 to Nov 16 is about 20 days, so the cost is about **$4.70** (`[estimate]`: $7 × 20/30, prorated). Downgrade back to Free (or delete the service) after **Nov 16, 11:45 PM ET**. The Blueprint defaults to `free` on purpose: Render's default for a new web service, `0.5c-512mb`, is paid ([Blueprint spec](https://render.com/docs/blueprint-spec)).

Memory: the standalone server measured about **120 MB RSS** after serving the page, `/api/health`, a fill run and a co-headliner run in mock mode (local, Node 20). That fits in 512 MB. `[assumption: live mode adds little; check the Render metrics after the first live runs]`

## Step by step: Render

Needs: a public GitHub repo (see "Before the repo goes public" below) and a Render account (free, sign up with GitHub).

1. Push the repo to GitHub. CI (`.github/workflows/ci.yml`) must pass on `main`.
2. In Render: **New → Blueprint**. Connect the GitHub repo and pick the `main` branch. Render reads `render.yaml`.
3. Render asks for the `sync: false` secrets. For the first deploy, **leave `QLOO_API_KEY` and `LLM_API_KEY` empty**: the app runs in mock mode with the banner showing.
4. **Apply.** Render builds the Dockerfile (about 2–4 min) and waits for `/api/health` to answer 2xx before it routes traffic ([health checks](https://render.com/docs/health-checks)).
5. Check the deploy:
   ```bash
   URL=https://routed.onrender.com            # your service URL (shown in the dashboard)
   curl -s $URL/api/health                     # {"ok":true,"modes":{"qloo":"mock","llm":"mock"}}
   curl -s -o /dev/null -w '%{http_code}\n' $URL/
   ```
   Open `$URL/?auto=1` in a private window and on a phone.
6. Region: `render.yaml` uses `virginia` (US East). `[assumption: most judging traffic is US-based; Qloo is in New York]`. The region can't be changed after creation.

Port: Render sets `PORT` and expects the app on `0.0.0.0` ([web services](https://render.com/docs/web-services#port-binding)). The image sets `HOSTNAME=0.0.0.0`, and Next's standalone `server.js` reads `PORT`.

### Environment variables

| Variable | Set on Render? | Value |
|---|---|---|
| `QLOO_API_KEY` | **Secret**, once the key arrives | Hackathon key. Empty = mock Qloo fixtures. |
| `LLM_API_KEY` | **Secret** | Google AI Studio (Gemini) key, free tier. Empty = scripted mock LLM. See docs/ENV.md for limits and the free-tier data-use note. |
| `QLOO_BASE_URL` | Preset in `render.yaml` | `https://hackathon.api.qloo.com` |
| `LLM_BASE_URL` | Preset | `https://generativelanguage.googleapis.com/v1beta/openai/`. `https://api.openai.com/v1` also works; other hosts also need `LLM_TRUSTED_BASE_URL` set to the exact URL. |
| `LLM_MODEL` | Preset | `gemini-3.5-flash-lite` (free tier; about 10 RPM / 500 RPD per project, per a third-party summary. Check AI Studio) |
| `ROUTED_FORCE_MOCK` | **Don't set it** in production | `1` forces mocks even with keys |
| `QLOO_TRUSTED_BASE_URL` | Don't set it | Only for a proxy or local mock |
| `NEXT_TELEMETRY_DISABLED` | Preset | `1` |

Keys are read at request time (`src/lib/config.ts`), so a key change only needs a restart, not a rebuild. Never pass keys as Docker build args: they would end up in the image layers.

## Switching from mock to live

1. Render dashboard → service → **Environment** → set `QLOO_API_KEY`, then **Save, rebuild and deploy** (or just restart).
2. `curl $URL/api/health` should now show `"qloo":"live"`. If it still says `mock`, check that `ROUTED_FORCE_MOCK` isn't set.
3. First live call: run `$URL/?auto=1` once. If Qloo answers 401, the README's "Base-URL discrepancy" section applies. Try `QLOO_BASE_URL=https://api.qloo.com` before assuming the key is bad.
4. Then set `LLM_API_KEY`; `/api/health` → `"llm":"live"`. Each provider switches on its own.

## Go-live checklist

- [x] **Verify the live API** (done 2026-10-21 locally: `node scripts/verify-qloo-live.mjs`, all endpoints 200 and schema-valid; hackathon host accepts the key) (README, "Going live", items 0–4): which host accepts the key; the heatmap response shape; that a corridor `POLYGON` returns cells; the music-venue tag id; that `urn:entity:destination` isn't 403; the `filter.popularity` / `signal.location.query` behaviour.
- [x] **Retune the thresholds** on live heatmaps for about 10 acts (done 2026-10-21: floor 0.6 → 0.94, strong/weak 0.75 / 0.60 → 0.95 / 0.91, read radius 25 → 5 / 15 mi; `docs/SOURCES.md`, "Live calibration").
- [x] **Re-check With vs Without Qloo on live data** (done 2026-10-21, 20 live fill runs; live results in the gitignored `docs-live/DEVPOST_SUBMISSION.live.md`). Don't change the proxy.
- [x] **Run the live baseline and compare it to the mock one** (done 2026-10-21: `baselines/live-2026-10-21/`, `baselines/live-2026-10-21-calibrated/`; gitignored).
- [x] **Re-run the eval with a live LLM** (done 2026-10-21 locally, live Qloo + Gemini `gemini-3.5-flash-lite`, 10 acts; `baselines/live-2026-10-21-gemini/`, gitignored). Re-run against the deployed server before submitting: `BASE_URL=$URL npm run eval -- "Act A" "Act B" …`. About 9 LLM calls per act, so 10 acts use about 90 of the free tier's daily requests. Live numbers go only into the gitignored `docs-live/` copy.
- [ ] **Fill every `[TODO]`** in `docs/DEVPOST_SUBMISSION.md`. Done: API lessons, the live With/Without example, the Qloo side of the eval. Still open: live URL, repo URL, video, the Plain AI eval numbers.
- [x] **Live screenshots** (done 2026-10-21, banner "LIVE QLOO · LIVE LLM"): run a server with both keys, then `OUT=screens-live BASE_URL=http://localhost:3300 npm run screens` (and `scripts/error-screen.mjs` against a server whose Qloo base URL is a closed loopback port for `11`). They go to the gitignored `screens-live/` for the Devpost upload only. The committed `screens/` are mock captures (banner "MOCK MODE"): retake them with a server started without keys.
- [ ] Upgrade the Render service to `0.5c-512mb` for Nov 2–16. Test the URL logged-out, on mobile and after 20 idle minutes.
- [ ] GitHub repo **About** shows the MIT license. No Qloo data committed (`tests/fixtures/qloo-shapes/` is synthetic; nothing live gets pasted there).
- [ ] Gemini limits checked in AI Studio (free tier: no spend, but a daily request cap). With a paid key, set a spend cap.
- [ ] Submit on Devpost before **Oct 30, 2026, 11:45 PM ET**.

## Live re-run (mock vs live baseline)

`npm run baseline` runs a fixed input set (default `scripts/baseline/inputs.v2.json`: 21 fill runs and 7 co-headliner runs = 28 inputs; v1 is the same set with the heat floor pinned at 0.6) against a running server, With and Without Qloo. It records the hard-filter drops and their reasons, both ranked lists per leg (affinity, population, venues, OSRM miles and hours from A and to B), the chosen fills and their "Why this stop" inputs, the co-headliner rankings with complementarity, every rule value, every Qloo request (endpoint, params, status, a sha256 prefix of the response; **no response bodies**), the git commit, hashes of the data files, a timestamp and the mode. Output goes to the gitignored `baselines/<mode>-<date>/` as `baseline.json` plus `summary.md`.

Reference runs: `baselines/mock-2026-10-19/` (v1, before the calibration), `baselines/live-2026-10-21/` (v1, live, before), `baselines/live-2026-10-21-calibrated/` and `baselines/mock-2026-10-21-calibrated/` (v2, after). The first mock reference is `baselines/mock-2026-10-19/`. Don't commit live baselines: they hold Routed's per-city scores derived from Qloo, and Qloo's FAQ says not to store response data in a public repo.

```bash
npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
# Live Qloo, mock LLM: only the Qloo side changes, so the comparison is clean. Keep the key out of shell history.
read -rs QLOO_API_KEY && export QLOO_API_KEY
env -u LLM_API_KEY PORT=3100 node .next/standalone/server.js &
curl -s localhost:3100/api/health          # must say "qloo":"live", "llm":"mock"
node scripts/verify-qloo-live.mjs          # every endpoint vs the zod schemas (prints shapes only)
node scripts/heat-read-sensitivity.mjs     # read radius and threshold quantiles (aggregates only)
npm run baseline -- --base http://localhost:3100 --delay-ms 500    # writes baselines/live-<date>/
npm run compare-baselines -- baselines/mock-2026-10-19 baselines/live-<date> --out baselines/mock-vs-live.md
```

### Live LLM (Gemini)

```bash
read -rs LLM_API_KEY && export LLM_API_KEY     # Google AI Studio key; never echo it
npm run verify:llm                              # tool-call round trip, JSON mode, number guard (prints booleans only)
PORT=3300 node .next/standalone/server.js &     # both keys set
curl -s localhost:3300/api/health               # "qloo":"live","llm":"live"
BASE_URL=http://localhost:3300 npm run eval -- "Act A" "Act B" …   # real Plain AI vs Routed + Qloo
OUT=screens-live BASE_URL=http://localhost:3300 npm run screens   # live captures, gitignored
```

Gemini's free tier is paced in code (6.5 s between LLM calls, `LLM_MIN_INTERVAL_MS`), so a live plan takes about a minute. Live eval output and live screenshots are Qloo-derived: keep them in `baselines/`, `screens-live/` and `docs-live/` (all gitignored).

You can also point `--base` at the deployed URL. `--only fill-demo,cohead-demo` runs a subset, and `--force` overwrites an existing folder. Expect about 250 Qloo requests in total (250 in mock; live can differ with paging and cache hits). The server's in-memory cache lasts 6 h, so repeat runs within that window are mostly cache hits. Each Qloo request is logged with status `cache` and the response hash it got the first time. The two `*-demo` inputs use fictional mock acts and are expected to fail live with an entity-not-found error. The report lists them under "Errored or missing inputs". The mock values for real artist names are synthetic (hashed profiles), so the mock vs live change in ranking says nothing about quality on its own. Use it to see **what moved and why**.

What to look at when retuning (`src/lib/touring/rules.ts`, then re-run and compare again):

- **Heat floor hit rate** (overview column "Heat floor"): the share of Qloo-read corridor candidates at or above `minAffinity` (0.94 since the 2026-10-21 calibration; designed to pass about 40%). If live heat is compressed (e.g. almost nothing ≥ 0.6, so 0 fills for real acts), lower the floor. If nearly everything passes, raise it. Pick a value from the live distribution ("Affinity of eligible cities", min / median / max), not from the mock.
- **Strong / weak hit rates** (co-headliner): the share of city reads ≥ `strong` 0.95 and ≥ `weak` 0.91 (designed: about 25% and 40%). These drive complementarity and the "recommended" picks. If no peer is ever recommended live, the strong threshold is too high for live values.
- **With vs Without divergence** within the live run: if top-5 overlap is close to 5, live affinity is tracking population and Qloo adds little on that leg. Report it honestly in the Devpost; don't tune the proxy.
- **Mock vs live rank agreement** (top-N overlap, Jaccard, Kendall τ, Spearman ρ, entered/left): this shows where live data changes the picks. Low agreement is expected. The values are input for the Devpost "Why Qloo is essential" example, not a pass/fail test.
- **Hard-filter drops** should match between runs unless `markets.json`, the road matrix or the rules changed. The header table flags changed data hashes.
- **Errored inputs** other than the two mock-only demos mean an API problem (shape, 401/403, rate limit). Check the Qloo request log in `baseline.json` before retuning anything.

After changing a threshold, rebuild, restart the live server and run `npm run baseline -- --out baselines/live-<date>-floor055`. Compare that against the first live run, not against the mock. Record the final values and the reason for them in `docs/SOURCES.md`. If the inputs need to change, copy them to `inputs.v2.json` and bump `version`; never edit v1 in place.

## Local Docker check

```bash
docker build -t routed .
docker run --rm -p 3000:3000 routed                      # mock mode
curl -s localhost:3000/api/health
docker inspect --format '{{.State.Health.Status}}' <container>   # healthy after ~20 s
```

Without Docker, the same server can run from a local build:

```bash
npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

## Public history

The public repository (`github.com/Mellowoah/Routed`) starts from a fresh, squashed history authored as
`Mellowoah <201105366+Mellowoah@users.noreply.github.com>`. It contains mock/sample data only: no live Qloo responses,
live screenshots or live eval numbers (those stay in the gitignored `baselines/`, `screens-live/` and `docs-live/`).
Before every push, check the branch you are pushing:

```bash
gitleaks git . --log-opts="publish" --redact                            # secrets in the history being pushed
git log --format='%h %an <%ae>' publish | sort -u -k2                  # only Mellowoah's identity
```

`LICENSE` names "Robert Clark (Mellowoah)" as the copyright holder (MIT).
