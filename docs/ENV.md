# Environment variables

Set these in `.env.local` for local runs, and in the hosting provider's dashboard for the public demo.
Never commit real values. `.gitignore` excludes every `.env*` file except `.env.example`.

| Variable | Required for live | Example / default | Where it comes from |
|---|---|---|---|
| `QLOO_API_KEY` | **Yes** (Qloo live) | *(empty = mock fixtures)* | Qloo hackathon API key request form (issued manually, allow a few business days). Sent as the `X-Api-Key` header. |
| `QLOO_BASE_URL` | No | `https://hackathon.api.qloo.com` | Fixed by Qloo: hackathon keys only work on this host. |
| `QLOO_TRUSTED_BASE_URL` | No | *(empty)* | Only for a proxy or local mock: the exact base URL Routed may send the key to. With it empty, the key goes only to `https://hackathon.api.qloo.com` or `https://api.qloo.com`. |
| `LLM_API_KEY` | **Yes** (LLM live) | *(empty = scripted mock LLM)* | Default provider: Google Gemini, key from Google AI Studio (free tier). Any OpenAI-compatible provider with tool calling works. |
| `LLM_BASE_URL` | No | `https://generativelanguage.googleapis.com/v1beta/openai/` | Gemini's OpenAI-compatible endpoint. `https://api.openai.com/v1` is also allowed; any other host is refused unless `LLM_TRUSTED_BASE_URL` matches it exactly. |
| `LLM_TRUSTED_BASE_URL` | No | *(empty)* | Exact base URL of a non-default provider (OpenRouter, Groq, a proxy…) that may receive `LLM_API_KEY`. Applies to the LLM key only: the Qloo key is only ever sent to Qloo hosts. |
| `LLM_MODEL` | No | `gemini-3.5-flash-lite` | Must support tool calling and `response_format: json_object`. |
| `LLM_MIN_INTERVAL_MS` | No | `6500` on Gemini, `0` elsewhere | Client-side spacing between LLM calls (one shared queue per server process). |

### Gemini free tier (checked 2026-10-21)

- **Endpoint.** Google documents the OpenAI-compatible base URL `https://generativelanguage.googleapis.com/v1beta/openai/` with Bearer auth, function calling (`tools`, `tool_choice: "auto"`) and structured output ([OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)). Google calls the compatibility layer beta.
- **Model.** `gemini-3.5-flash-lite` is a stable model with function calling and structured outputs ([model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), updated 2026-07-30), and it is "Free of charge" on the free tier ([pricing](https://ai.google.dev/gemini-api/docs/pricing), updated 2026-10-19). It was in the key's `/models` list on 2026-10-21, as were `gemini-3.8-flash` and `gemini-3.6-flash`.
- **Why Flash-Lite and not 3.8 Flash.** One plan makes about 6–10 LLM calls. Google does not publish per-model free-tier numbers: limits are per project, in RPM / TPM / RPD, shown in AI Studio, "not guaranteed", and RPD resets at midnight Pacific ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), updated 2026-10-15). A third-party summary (scriptbyai.com, Oct 2026; not Google) lists **3.8 Flash / 3.6 Flash: 5 RPM, 250k TPM, 20 RPD** and **3.5 Flash-Lite: 10 RPM, 250k TPM, 500 RPD**. At 20 requests a day a judge could not finish three plans, so Flash-Lite is the default. Check your own project's limits in AI Studio.
- **429 handling.** Past a limit Gemini answers `429 RESOURCE_EXHAUSTED`. Routed spaces Gemini calls 6.5 s apart, retries 429 up to 3 times, and waits as long as the response says (`Retry-After`, or `retryDelay` in the error body), capped at 30 s.
- **Thought signatures.** Gemini 3 models return `extra_content.google.thought_signature` on tool calls and answer 400 if it is not sent back. Routed keeps it with the assistant turn and never shows it.
- **Data use.** On the free tier Google's pricing page says content is "Used to improve our products: Yes". Plans send Qloo results (artist names, city reads) to the model, so use a paid tier for anything you would not share with Google.
| `ROUTED_FORCE_MOCK` | No | `1` to force mocks | Offline demos and tests. Leave unset in production. |

Each provider switches independently: with only `QLOO_API_KEY` set, Qloo data is real and the scripted mock LLM writes the briefs.

Cost note `[estimate]`: one plan is about 7 LLM turns. On the Gemini free tier that costs nothing, but the daily
request limit caps traffic (about 50 plans a day at 500 RPD). On a paid key a small model costs a few cents per plan
at most; set a spend cap on the account.
