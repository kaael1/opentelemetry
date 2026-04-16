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

## Configuration

- `CODEX_HOME`: Codex home directory. Default: `%USERPROFILE%\.codex`.
- `PORT`: HTTP port. Default: `8787`.

Example:

```powershell
$env:CODEX_HOME = "$env:USERPROFILE\.codex"
$env:PORT = "8787"
npm start
```

## Safety

`opentelemetry` is read-only. It scans local session/log artifacts and serves a
local dashboard. It does not modify Codex files, sessions, logs, repositories, or
configuration.

Do not publish screenshots or exported JSON from the dashboard unless you have
reviewed them for secrets, prompts, local paths, or private repository details.

## License

MIT License. See [LICENSE](./LICENSE).
