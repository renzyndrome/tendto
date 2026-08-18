# 06 — The AI Layer (2026)

TendTo's AI comes in **two tiers**, benchmarked against Notion AI, with a deliberate edge:
**calm curation**, a **privacy/BYO-model stance**, and — now that the app itself is local-first —
an **offline/local AI option** Notion structurally can't match. All facts current as of mid-2026
(sources below).

## The two tiers (this framing keeps "full AI" from becoming clutter)

- **Ambient (on by default):** the once-a-day **summary** of wins + task status. Runs by itself, off
  the editing surface, one toggle to disable (doc 01, doc 02).
- **Interactive (on-demand, opt-in per use):** **per-page Summarize**, inline **Ask AI**
  (rewrite / translate / shorten / fix), and later **Q&A over your workspace**. These fire only when
  the *user* triggers them (`/summarize`, or select → Ask AI) — so a "full" integration is still
  calm, because nothing is ambient noise.

> **Status (2026-07-09):** the ambient daily summary is implemented server-side in `app/ai/`
> — a provider abstraction (OpenAI-compatible HTTP provider + an **offline no-key fallback** so it
> runs without a model), a tenancy-scoped activity gatherer, and `POST /ai/daily-summary` as the
> user-triggered entry point. The once-daily ambient job `run_daily_summaries()` is scaffolded;
> scheduler + delivery are deferred. Configure with `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`
> (point `AI_BASE_URL` at an Ollama `/v1` for the local option). The **interactive** tier
> (per-page Summarize, Ask AI, workspace Q&A + pgvector) is not built yet.
>
> **Status (2026-08-18):** the summary is now a real, visible feature, and it *recommends*.
>
> - **A third engine: the local `claude`/`codex` CLI** (`AI_CLI=claude`), shelling out to the
>   operator's already-authenticated subscription — no API key, no per-token bill. Engine order:
>   `AI_CLI` > `AI_API_KEY` > offline fallback. This is a **dev/self-host convenience only**: a
>   hosted multi-tenant deployment must use API keys, both for the vendors' subscription terms
>   (one person's plan serving other users) and because the CLI is a real process on the server
>   host. Note `AI_BASE_URL` already covers Anthropic's OpenAI-compat endpoint
>   (`https://api.anthropic.com/v1`), so "use the API" was config, not code.
> - **The digest gained the forward-looking half**: overdue and next-two-days items (bounded,
>   never `done`), so the model's "Tomorrow" section recommends specific tasks by name instead
>   of inventing generalities — and an idle day with a deadline is no longer reported as calm.
> - **First UI surface**: a sidebar **Daily recap** view (`/recap`, days routable like the
>   calendar's), calling `POST /ai/daily-summary` with the *local* date and caching per day so
>   browsing history doesn't re-bill. The scheduled ambient job + delivery remain deferred.
> - **Structured, not a text blob**: the endpoint returns the digest alongside the prose
>   (`activity` + `engine`), so the UI renders overdue in the danger colour and upcoming in the
>   new `warn` token, with the AI prose as the narrative — hidden under the offline engine,
>   where it would only repeat the digest. The recap also summarizes **periods**: day, week,
>   month, or everything so far (calendar-aligned; recommendations always anchored on now).

## Notion AI in 2026 — the benchmark (what to adopt, what to skip)

| Notion AI feature | What it is | TendTo |
| --- | --- | --- |
| **Q&A over workspace** | Ask a question; RAG scans pages; answer with citations | **Adopt (later)** — pgvector RAG (doc 05) |
| **AI blocks / per-page summarize** | "AI Summary" block auto-summarizes a page | **Adopt (core)** |
| **Inline Ask AI (Cmd+K)** | Highlight → summarize / rewrite / tone / translate | **Adopt** — selection-aware inline actions |
| **Database AI autofill** | AI properties summarize a row, tag, batch-run | **Adopt (later, minimal)** |
| **AI Meeting Notes** | Transcribe + summarize meetings | **Skip** — not a core use case |
| **AI Agents / Workers** | Autonomous multi-step agents | **Skip** — the complexity/clutter edge |
| **Smart connectors** | Index Slack/Jira/GitHub/Drive | **Skip early** — later, prefer MCP (below) |
| **Model router + RAG** | Routes to Claude/GPT/small models over retrieval | **Adopt the pattern** — thin router + pgvector RAG |

**Notion AI's limits are TendTo's opening:** it **requires internet for every call**, it's a **paid
per-seat add-on** (~$8/member/mo, capped actions), and you **can't bring your own model or point it
at a self-hosted one**. TendTo's stance: no per-seat AI tax, bring-your-own-key, and a local/self-
hosted (Ollama) option — which, combined with the local replica, means **summarize a page with zero
network**: a feature Notion's architecture cannot offer.

## The daily summary — the signature feature (and why this architecture makes it easy)

A scheduled FastAPI job runs each evening per user: **one SQL query** gathers the day's completed
tasks, touched pages, and upcoming due dates (in the CRDT design this required decoding document
blobs server-side — now it's a plain read of the source of truth), an LLM turns it into a short calm
recap, and it's delivered as a daily note/notification. Structured output (wins, open items,
tomorrow) so the note renders consistently. One toggle in Settings to disable.

## Per-page Summarize — the headline interactive feature

- **Trigger:** `/summarize` or a page-menu action; **selection-aware**.
- **Output:** a summary block at the top, or an inline result the user can keep/discard.
- **Editor fit:** **BlockNote ships a first-class AI extension** (inline commands + streaming,
  model-agnostic via the Vercel AI SDK) — well-trodden on our editor, not custom plumbing.
- **Serving:** FastAPI streams tokens over **SSE** into the editor; the backend router picks a
  cheap/fast hosted model by default, or the user's own key / self-hosted Ollama endpoint.

## The five sub-layers (2026 landscape)

| Sub-layer | 2026 state | TendTo's pick |
| --- | --- | --- |
| **Models** | Frontier (Claude Opus 4.8, GPT-5.5, Gemini 3.1, Claude Fable 5) + near-parity open weights (GLM-5.2, DeepSeek V4, Qwen3.5, Kimi K2.5). Everyone **routes**. | Route: cheap/fast for summaries; frontier only for hard Q&A synthesis |
| **Orchestration** | Python: native SDKs + LangChain/LlamaIndex. TS: Vercel AI SDK | **Python-native in FastAPI** — the AI layer now lives in your strongest language; BlockNote's editor-side extension uses the Vercel AI SDK |
| **Integration** | **MCP** is the standard (10k+ servers; Linux Foundation) | **Expose a TendTo MCP server** so users' own AI can act on their workspace |
| **Retrieval (RAG)** | **pgvector on Postgres** is the default; hybrid search adds 20–35% | pgvector — same Postgres, no new infra |
| **Local / on-device** | **Ollama** (OpenAI-compatible local API); open models near-frontier | The **offline + privacy** option — local replica + local model = fully offline AI; on-brand for local-first |

## Recommended AI stack

| Concern | Choice |
| --- | --- |
| AI gateway / router | Thin FastAPI-side router (task → model); features never hard-code a provider |
| Summarize / inline model | Cheap/fast hosted **or** user-configured Ollama endpoint |
| Q&A synthesis model | A stronger model, over pgvector retrieval |
| Streaming | **SSE** from FastAPI into the editor |
| Editor integration | **BlockNote AI extension** |
| Retrieval | **pgvector** + hybrid search |
| Output | **Structured** where it matters (daily summary fields) |
| External | **TendTo MCP server** |

## AI roadmap (layers onto doc 03/07)

- **AI-0 — Nothing in the MVP** (Phase 0/1). Editor, cloud sync, collections first.
- **AI-1 — Ambient daily summary** (Phase 3). One SQL query over server Postgres + one LLM call,
  scheduled. Cheap because the source of truth is plain relational rows.
- **AI-2 — Per-page Summarize + inline Ask AI** (Phase 3). Streamed via the BlockNote AI extension.
- **AI-3 — Local-model (Ollama) option** (Phase 3/4). Offline, private summarize — with the local
  replica, the Notion-beating differentiator returns in full.
- **AI-4 — Q&A over workspace** (Phase 4). pgvector + hybrid RAG, answers with citations.
- **AI-5 — TendTo MCP server** (Phase 4+). Let external AIs read/write a workspace.
- **Deferred / earn-it:** database batch-AI, connectors. **Skip:** autonomous agents/workers.

## Cost & privacy posture

- **Cost:** routing + a small model make per-page and daily summaries fractions of a cent; batch
  where possible. No per-seat AI tax on users.
- **Privacy:** default hosted with plain disclosure; **BYO key or self-hosted Ollama** for users who
  want data kept on their own infrastructure; never send workspace data to a model the user didn't
  opt into. Every interactive action is user-triggered.

## Sources

- Notion AI 2026: [What's new / releases](https://www.notion.com/releases) · [Notion AI product](https://www.notion.com/product/ai) · [Notion AI complete guide 2026](https://aitoolsdevpro.com/ai-tools/notion-ai-guide/) · [Notion AI features 2026 (Fazm)](https://fazm.ai/blog/notion-ai-features-2026)
- Landscape: [LLM leaderboard 2026](https://www.vellum.ai/llm-leaderboard) · [MCP adoption 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) · [pgvector RAG 2026](https://www.digitalapplied.com/blog/build-self-hosted-rag-postgres-pgvector-tutorial-2026) · [Local LLMs with Ollama 2026](https://daily.dev/blog/running-llms-locally-ollama-llama-cpp-self-hosted-ai-developers/)
