# CLAUDE.md — Working rules for ChatUI-local

Persistent instructions for AI coding agents on this repo. Keep changes tightly scoped.

## What this repo is

A local-first desktop chat app: **Tauri 2 (Rust shell) + React 19 + TypeScript + Vite 7
+ Tailwind + shadcn/ui**. No Supabase, no router, no auth — all persistence is
localStorage plus JSON files under `~/Documents/chatUI` (managed by the Rust side).

- **Chat** — `src/components/ChatView.tsx` (the whole UI: sessions, projects, settings
  views). Every send runs through a **LangChain Deep Agents** runtime:
  - `src/hooks/use-deep-agent.ts` — run/stop/interrupt state machine consumed by ChatView.
  - `src/lib/agent/runtime.ts` — `DeepAgentSession` (createDeepAgent, v3 streamEvents,
    system prompts incl. council/research mode prompts).
  - `src/lib/agent/tools.ts` — built-in tools (time/date/weather/web_fetch,
    create_artifact, run_python, request_structured_input, search_skills,
    search_connectors, suggest).
  - `src/lib/agent/{models,skills,mcp,run-context,types}.ts` — ChatOpenAI factory
    (OpenAI-compatible endpoints only), skill files, remote MCP tools, per-run context.
  - `src/lib/run-python.ts` → Tauri command `run_python` in `src-tauri/src/lib.rs`
    (system python3, temp file, try_wait poll + kill on timeout).
- **Rich content** — `src/components/markdown-renderer.tsx` renders LaTeX (KaTeX),
  ```mermaid, ```chart (Vega-Lite), ```svg fences, prism syntax highlighting.
  `src/components/artifact-panel.tsx` is the editable side panel (CodeMirror editing
  with overrides in `src/lib/artifacts.ts`, Python run console, React preview via
  esbuild-wasm + esm.sh in `src/lib/react-preview.ts`, md/html/pdf/docx export in
  `src/lib/export-artifact.ts`).
- **Legacy/dead but kept** — `AgentView.tsx`, `use-opencode.ts`, `use-deep-research.ts`,
  `use-model-council.ts`, `src/lib/research/`, `src/lib/tools.ts`. Unwired from the send
  flow; do not re-wire or delete without asking.
- `src/lib/llm.ts` is still used for chat titles + memory extraction
  (`buildSystemPrompt` is exported and reused by the agent runtime).

## Working rules

1. **Scope first.** Only touch files the task needs; if a fix seems to need a surprising
   file, stop and say why before editing it.
2. **Always end with:** `npm run build` (runs `tsc && vite build`) and `npm test`
   (vitest). After Rust changes also `cargo check` + `cargo test` in `src-tauri/`.
   Show the diff and explain each change before anything is accepted.
3. **No refactors, renames, dependency changes, or reformatting** unless explicitly
   asked. Match the existing code style in each file exactly.
4. **Ask, don't assume.** If an API/library surface is uncertain, verify it in
   `node_modules` or docs first — do not guess.
5. **LSP lies.** The editor LSP sometimes reports stale "cannot find module" errors for
   `src/components/skills-dialog.tsx`, `src/components/mcp-dialog.tsx`, and
   `src/components/suggestion-card.tsx`. Trust `tsc` (the build), not those diagnostics.
6. **Never commit secrets.** Provider API keys live in localStorage only.

## Architecture notes that bite

- **One agent run per send.** A fresh langgraph `thread_id` is created per user message;
  history is replayed from the message tree. A thread is reused only to resume
  structured-input interrupts (max 4 rounds, see `use-deep-agent.ts`).
- **Artifacts are derived, not stored.** `extractArtifacts()` re-parses message content
  on every render; edits in the panel live in the module-level override store in
  `src/lib/artifacts.ts`, keyed by the original artifact.
- **Custom Tauri commands need no capabilities entries** (mirrors `http_fetch`).
  Command return values serialize as-is — use `#[serde(rename_all = "camelCase")]`
  (see `HttpFetchResponse`, `PythonRunResult` and their unit tests).
- **React preview iframes** use `sandbox="allow-scripts allow-same-origin"` because the
  compiled module is loaded from a blob URL; plain HTML previews stay `allow-scripts` only.
- **CORS: strip X-Stainless-* AND User-Agent headers.** The openai client under ChatOpenAI
  adds telemetry headers (and a custom User-Agent) that break CORS preflights against most
  OpenAI-compatible providers; `models.ts` passes a `corsSafeFetch` that removes them.
  Chrome silently drops the forbidden User-Agent, but WKWebView includes it in the
  preflight's Access-Control-Request-Headers — so with it, requests fail with "Load failed"
  **in the Tauri app only**. Never let those headers reach the wire.
- **web_fetch has three transports** (`src/lib/http-fetch.ts`): Rust `http_fetch` command
  under Tauri, a vite dev middleware (`/__http-fetch` in `vite.config.ts`, skipped under
  vitest via `MODE !== "test"`), and native fetch as last resort (CORS-restricted).
- **History is truncated to a token budget** (`src/lib/agent/history.ts`) before replay:
  models.dev `limit.context` when known, 8k for localhost providers, 32k fallback, minus
  4k reserve for system prompt + tool schemas + output.
- **OpenCode server** (port 2138) is spawned/adopted by the Rust shell for the legacy
  agent half; env vars are sanitized there — keep that behavior.
- **App updates** (`src/lib/updater.ts` + `src/components/updates-panel.tsx`): the app
  pings a static `latest.json` on GitHub Releases on launch (if auto-check is on in
  Settings → Updates). `tauri-plugin-updater` verifies the signed bundle against the
  pubkey in `tauri.conf.json` before installing. Building release artifacts requires
  `TAURI_SIGNING_PRIVATE_KEY` env var (set in CI secrets, not committed). The release
  workflow is `.github/workflows/release.yml` (tauri-action on `v*` tag push).
- **Mode triggers** (`src/lib/mode-triggers.ts`): typing "discuss…", "teach me…",
  "i want to learn…", or "research…" as the first word of the composer auto-activates
  the corresponding chat mode (button lights up blue + expands). Detection is live:
  deleting the word reverts the mode. Manual toggles always win over auto-detection.
- **Skill/connector discovery** (`search_skills` / `search_connectors` / `suggest` tools):
  the agent can search the skill and connector catalogs at runtime and present actionable
  suggestion cards (`src/components/suggestion-card.tsx`) in place of the composer textbox.
  Suggestions are non-blocking (the run continues). The `suggest` tool emits a `suggestion`
  AgentEvent via `RunContext.emit` (same pattern as `create_artifact`). Google Workspace
  and Microsoft 365 are covered by the Zapier connector (keywords field in `McpCatalogEntry`).

## Commands

- `npm run dev` — Vite dev server (Tauri dev via `npm run tauri dev`)
- `npm run build` — `tsc && vite build` (the type check)
- `npm test` — vitest run
- `cargo test` in `src-tauri/` — Rust unit tests (network smoke tests are `#[ignore]`)
