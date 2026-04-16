# opentelemetry

Local, real-time observability dashboard for Codex sessions, spawned agents,
tool calls, timeline events, and parallel work lanes.

The app is intentionally small: one Node.js server, static HTML/CSS/JS, no
runtime dependencies, and read-only access to your local Codex telemetry files.

## Features

- Watches Codex `sessions/**/*.jsonl` and streams updates with Server-Sent Events.
- Shows spawned agent designations, reports, status, and changed-file hints.
- Provides an enriched Timeline with grouped events, tool calls, command output,
  patch summaries, durations, status, filters, and expandable details.
- Provides Parallel Lanes grouped by parent session, with phase segments,
  heatmaps, dependency edges, mini-logs, focus mode, sorting, and visual replay.
- Provides optional local AI for semantic search, reranking, similar events, and
  narrative explanations when explicitly enabled.
- Includes a beginner guide and storytelling questions for reading telemetry as
  a session narrative.
- Runs locally on `127.0.0.1` and does not upload Codex logs anywhere.

## Requirements

- Node.js 18 or newer.
- A local Codex data directory, normally `%USERPROFILE%\.codex` on Windows.

## Usage

```powershell
cd C:\Users\mikae\codex-agent-dashboard
npm start
```

Abra `http://127.0.0.1:8787`.

## Reading The Dashboard

1. Confirm the header says `ao vivo`.
2. Start with `Parallel Lanes` to see which agents worked in parallel.
3. Click `focar` on a lane to follow one agent across the dashboard.
4. Open Timeline events to inspect commands, outputs, patches, and files.
5. Use `Ask Telemetry` and the storytelling chips to ask what happened, where
   the first problem appeared, and what to check next.

## Configuration

- `CODEX_HOME`: Codex home directory. Default: `%USERPROFILE%\.codex`.
- `PORT`: HTTP port. Default: `8787`.
- `AI_ENABLED`: set to `1` to enable local embedding/rerank models.
- `AI_EMBED_MODEL`: default `BAAI/bge-small-en-v1.5`.
- `AI_RERANK_MODEL`: default `Xenova/bge-reranker-base`.
- `AI_LLM_BASE_URL`: OpenAI-compatible local LLM endpoint. Default
  `http://127.0.0.1:8791/v1`.
- `AI_LLM_MODEL`: model name sent to the local LLM endpoint.

Example:

```powershell
$env:CODEX_HOME = "$env:USERPROFILE\.codex"
$env:PORT = "8787"
npm start
```

## Optional Local AI

The dashboard works without AI dependencies. Search falls back to text matching,
and explanations show the best evidence available.

To enable local embeddings/rerank:

```powershell
npm install
$env:AI_ENABLED = "1"
npm start
```

Then, in another terminal:

```powershell
npm run ai:check
npm run ai:index
```

For narrative explanations, run a local OpenAI-compatible LLM server separately,
for example llama.cpp, LM Studio, or Ollama-compatible tooling. A good fit for a
6 GB laptop GPU is a 4B GGUF model such as `Qwen/Qwen3-4B-GGUF` with `Q4_K_M`.

## Safety

`opentelemetry` is read-only. It scans local session/log artifacts and serves a
local dashboard. It does not modify Codex files, sessions, logs, repositories, or
configuration.

Do not publish screenshots or exported JSON from the dashboard unless you have
reviewed them for secrets, prompts, local paths, or private repository details.

## License

MIT License. See [LICENSE](./LICENSE).
