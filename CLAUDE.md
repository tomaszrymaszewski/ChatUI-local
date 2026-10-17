# CLAUDE.md — Working rules for ChatUI-local

Persistent instructions for AI coding agents on this repo. Keep changes tightly scoped.

## What this repo is

A local-first desktop chat app: **Tauri 2 (Rust shell) + React 19 + TypeScript + Vite 7
+ Tailwind + shadcn/ui**, no router. All persistence is local-first: chats + sessions
live in IndexedDB (`chatui-store`, via a sync in-memory mirror in `src/lib/idb-store.ts`
— localStorage's ~5MB WebKit cap couldn't hold them), everything else in localStorage
(agents, projects, schedules, provider keys), plus files under the OS app-data dir
`~/Library/Application Support/com.tomaszrymaszewski.chatui/` (managed by the Rust
side). **Never use `~/Documents`** — that base was removed; a one-time startup
migration (`migrate_legacy_chat_ui_dir` in `src-tauri/src/lib.rs`, runs in `setup()`)
moved skills/agents/mcp-tokens/logs/index.db over and deleted the old folder.
Optional **Supabase accounts** (`@supabase/supabase-js`, creds in `.env`) add cloud
sync on top of the local store — anonymous mode works fully offline and is unchanged.

- **Chat** — `src/components/ChatView.tsx` (the whole UI: sessions, projects, settings
  views). Every send runs through a **LangChain Deep Agents** runtime:
  - `src/hooks/use-deep-agent.ts` — run/stop/interrupt state machine consumed by ChatView.
  - `src/lib/agent/runtime.ts` — `DeepAgentSession` (createDeepAgent, v3 streamEvents,
    system prompts incl. council/research mode prompts).
  - `src/lib/agent/tools.ts` — built-in tools (time/date/weather/web_fetch,
    create_artifact, share_files, run_python, request_structured_input, search_skills,
    search_connectors). Scheduling/workflow tools exist only for dedicated (saved)
    agents (`sandbox.agentId`). Every chat-tab send is agentic (the old "Agentic"
    toggle is gone); learn/research/council remain special modes.
  - `src/lib/agent/suggestions.ts` — post-run suggestion cards: after a message
    ends, a separate small model call over the transcript + not-installed-skills/
    not-connected-connector digests decides whether to show a skill/connector/mode
    card (`AgentController.showSuggestion`). The agent itself has no suggest tool.
  - `src/lib/agent/{models,skills,mcp,run-context,types}.ts` — ChatOpenAI factory
    (OpenAI-compatible endpoints only; maxTokens comes from models.dev `limit.output`,
    8192 fallback — omitting it means small provider defaults like DeepSeek's 4096),
    skill files, remote MCP tools + on-demand proxy, per-run context.
  - `src/lib/run-python.ts` → Tauri command `run_python` in `src-tauri/src/lib.rs`
    (system python3, temp file, optional cwd — defaults to the run's deliverables
    folder, try_wait poll + kill on timeout).
- **Rich content** — `src/components/markdown-renderer.tsx` renders LaTeX (KaTeX,
  both `$$…$$` and single-`$…$`; pandoc-style guards keep prices like "$5 and $10"
  literal — `singleDollarTextMath` is on),
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
5. **LSP lies.** The editor LSP sometimes reports stale "cannot find module" errors or
   phantom files (e.g. `src/components/skills-dialog.tsx`, a `__probe.test.ts`). Trust
   `tsc` (the build), not those diagnostics.
6. **Never commit secrets.** Provider API keys live in localStorage only.

## Architecture notes that bite

- **One agent run per send.** A fresh langgraph `thread_id` is created per user message;
  history is replayed from the message tree. A thread is reused only to resume
  structured-input interrupts (max 4 rounds, see `use-deep-agent.ts`).
- **Artifacts are derived, not stored.** `extractArtifacts()` re-parses message content
  on every render; edits in the panel live in the module-level override store in
  `src/lib/artifacts.ts`, keyed by the original artifact.
- **Big keys bypass localStorage** (`src/lib/idb-store.ts`): `chatui:sessions` and
  `chatui:messages:*` persist in IndexedDB behind a sync mirror (ordered write-behind;
  tests/SSR without IndexedDB transparently use localStorage). Touch them only via
  `readBigKey`/`writeBigKey`/`removeBigKey`/`listBigKeys` — never raw localStorage.
  Boot preloads + sweeps stragglers in `main.tsx`; mirror writes mark sync-dirty via a
  listener sync.ts registers (sync's own applies pass `dirty:false`); quota evictions
  never sync. Local reset (Account → Data) suspends the storage hook during the wipe
  so cleared keys can't upload tombstones, then reloads into a fresh-link pull.
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
  When plain HTTP is blocked or bot-challenged, `fetchPageText` re-renders the page in
  the user's headless Chrome via the Rust `browser_fetch` command (Chrome preferred,
  Chromium/Brave/Edge fallback, `--dump-dom` with a throwaway profile); `web_search`
  uses the same browser rendering as its primary keyless backends (DDG HTML, then Bing
  HTML with `/ck/a` redirect unwrapping) before falling back to plain-HTTP Bing RSS.
- **History is truncated to a token budget** (`src/lib/agent/history.ts`) before replay:
  models.dev `limit.context` when known, 8k for localhost providers, 32k fallback, minus
  4k reserve for system prompt + tool schemas + output.
- **Thinking effort has no "Default" slot.** The composer slider lists only the model's
  real levels (plus Off where a toggle dialect is known; toggle-only models get On/Off).
  An unset session resolves at send time to the model's *middle* tier
  (`resolveDefaultReasoningEffort` in `model-capabilities.ts`, "medium" preferred) — in
  `models.ts` for both the OpenAI-compatible and Anthropic paths — and the composer shows
  that exact level as muted text next to the model name ("GLM 5.3 · High"). Never send
  "nothing" for an unset session: provider defaults are often thinking-off (and the old
  GLM special case forced the lowest tier — removed).
- **PDFs + on-device OCR**: the pdf.js worker is bundled via vite `?url` (never a CDN —
  the packaged WKWebView app must extract offline). Scanned (image-only) PDFs are
  rendered by pdf.js; vision models get the page images, and models WITHOUT vision get
  on-device OCR via the Rust `ocr_image` command (macOS Vision framework, `objc2-vision`
  — no external tools) in `attachment-context.ts` (send + history replay; replay caches
  the OCR text via `setFileText`). Agent-mode attachments still go to disk for
  `read_local_file` (pdftotext).
- **Agent browser + PATH**: all agent shell spawns use `login_shell_command()`
  (`$SHELL -lic`) — GUI-launched apps miss ~/.zprofile/~/.zshrc, so plain `sh -lc`
  cannot see homebrew/nvm binaries (node, npx, blender). This broke the built-in
  Playwright browser, run_node, and coding-agent delegation in the packaged app. The
  MCP client declares the home folder as an MCP root (`mcp.ts`) — @playwright/mcp
  derives its persistent Chrome profile from the first root
  (`~/Library/Caches/ms-playwright-mcp/mcp-chrome-<sha256(root)[:7]>`) and throws
  without one. "Browser sign-in" (Settings → Connectors → Rust `browser_login_open`)
  opens that profile headed so the user can log into Gmail etc. once; the headless MCP
  server stops first (one Chrome per profile) and restarts lazily — the user must close
  the sign-in window for agent runs to use the browser.
- **OpenCode server** (port 2138) is spawned/adopted by the Rust shell for the legacy
  agent half; env vars are sanitized there — keep that behavior.
- **Deliverables + share_files**: `run_python`/`run_node` default their cwd to the run's
  deliverables folder (`<base>/files/<sessionId>`, threaded via `DeepAgentSession` opts).
  Files are invisible to the user until `share_files` is called — it emits the `files`
  AgentEvent; `ChatView` renders download/Open/Reveal chips (persisted + live mid-run).
  `share_files` expands `~` and emits a visible error activity when every path is skipped.
- **Task-finish notifications** (`src/lib/notify.ts`, `tauri-plugin-notification`):
  headless/scheduled runs notify from `runHeadlessTask`; interactive runs notify from the
  controller's run `finally` only when `document.hidden` (Setting → General toggle
  `taskFinishNotifications`, default on). Clicking focuses the app window. Never rejects.
- **Mac app control**: task-profile agents with terminal access get `open_app` (Rust
  `open_app` → `open -a`) and `run_applescript` (Rust `run_applescript` → temp-file
  osascript, same try_wait/kill pattern as run_python). Both go through the
  `requestApproval` card like `run_command` and are stripped with it when
  `enableCommandTools === false`; the agent-settings "Terminal & coding" toggle covers them.
- **App updates** (`src/lib/updater.ts` + `src/components/updates-panel.tsx`): the app
  pings a static `latest.json` on GitHub Releases on launch (if auto-check is on in
  Settings → Updates). `tauri-plugin-updater` verifies the signed bundle against the
  pubkey in `tauri.conf.json` before installing. Building release artifacts requires
  `TAURI_SIGNING_PRIVATE_KEY` env var (set in CI secrets, not committed). The release
  workflow is `.github/workflows/release.yml` (tauri-action on `v*` tag push).
- **Accounts + cloud sync** (`src/lib/supabase.ts`, `src/hooks/use-auth.ts`,
  `src/lib/sync.ts`, `supabase/schema.sql`): email/password auth; every tracked
  `chatui:*` key mirrors to one `user_data` row per (user, key), stored as plaintext —
  E2E encryption was removed (it broke down when devices held different keys, e.g. dev vs
  production app — different webview origins get different localStorage, so each device
  generated its own key and every row looked undecryptable; a future, better design may
  reintroduce it). Rows still in the old AES envelope shape are never pulled and get
  overwritten by live local data on push (`isLegacyEnvelope`). Sync is per-key
  last-write-wins with tombstones, except sessions/message stores/agents
  which union-merge by record id (`mergeRecordLists`, `planSync` — pure, unit-tested);
  message records merge by `updatedAt` (creation-timestamp fallback for legacy
  records — never by `timestamp` alone, which two writers share and which made
  concurrent versions flip-flop), and every message write stamps `updatedAt`
  (addMessage/updateMessage/updateMessageHeadless);
  ambiguous states fail closed toward local (blank cloud rows never overwrite populated
  data; deletes travel as tombstones — `deleteProvider` drops the key when the list empties).
  Egress is frugal: full syncs fetch a value-less manifest first and download values only
  for rows that moved since the last reconcile (unchanged keys are neither downloaded nor
  re-uploaded); instant cross-device updates ride Supabase Realtime postgres_changes on
  `user_data` (`createRealtimeSubscription`, requires the table in the supabase_realtime
  publication — see schema.sql), batched 300 ms and reconciled through the same path
  (`syncRows`); the value-less-manifest poll runs every 5 min + on focus (throttled) as
  the fallback. Pushes stay write-debounced (2 s). Hooks must re-read storage in
  mutations and dispatch `*-changed` events so pulls can't be clobbered or go stale.
  Successful syncs also write JSON backups to `<base>/backups/` via the existing
  `write_text_file` command. Never put the Supabase *secret* key in the app — only the
  publishable key in `.env`. Attachment BYTES never sync — they live in IndexedDB
  (`chatui-files`) device-only; sync carries message records with attachment metadata only.
- **One run per chat across contexts** (`src/lib/run-state.ts`): a chat can be
  mid-run in another app window/instance, or on another device syncing in. Its
  in-progress assistant record is fresh + unfinalized (no `workEndedAt`, open
  last segment, `updatedAt` inside `RUN_ACTIVE_WINDOW_MS` = 90 s). `loadMessages`
  keeps such records raw (only stale ones settle, as before), the message renders
  as "Working for …" instead of a "Worked for …" summary that keeps growing, and
  every send path (handleSend/handleSaveEdit/handleRegenerate + `AgentController.run`)
  refuses to start a second run ("already running in another app window or on
  another device") so two runs can't interleave into one session.
- **Attachments to agents as file paths** (`src/lib/attachment-context.ts`,
  `src/lib/deliverables.ts`, Rust `write_file_base64`): on agent runs (agent tab + task
  mode, i.e. whenever `taskProfile` exists), non-image chat attachments are copied into
  the run's deliverables folder (`<dir>/attachments/<id>-<name>`) and expressed to the
  agent as a path note instead of inline text (images still embed as data URLs; plain
  chat runs keep inline text — no file tools there). `use-deep-agent` adds the run's
  deliverables dir to the sandbox `allowedDirectories` so saved agents can read those
  paths (and their own deliverables); browser dev without Tauri falls back to inline
  text.
- **Mode triggers** (`src/lib/mode-triggers.ts`): typing "discuss…", "teach me…",
  "i want to learn…", or "research…" as the first word of the composer auto-activates
  the corresponding chat mode (button lights up blue + expands). Detection is live:
  deleting the word reverts the mode. Manual toggles always win over auto-detection.
- **Skill/connector discovery — one system for both, registry-driven + RAG.** The
  catalog lives in `registry.json` **at the repo root** (skills + connectors sections,
  both with `keywords`) and is fetched from raw.githubusercontent at launch, cached in
  localStorage (24 h TTL) with in-bundle fallbacks (`CURATED_SKILLS`, `MCP_CATALOG`).
  - **Skills**: `src/lib/skill-registry.ts` (registry fetch/cache/custom entries) +
    `src/lib/skills-library.ts` (disk install/list). Install-on-demand: bundled skills
    auto-install at launch (`ensureBundledSkillsInstalled`); everything else installs on
    first use — `search_skills` (semantic over the knowledge index, keyword fallback)
    installs a matching miss and inlines its SKILL.md. `loadSkillFiles` virtualizes at
    most `MAX_ADVERTISED_SKILLS` (8) into `/skills/<name>/SKILL.md` — RAG-matched
    skills first, then MRU (sandboxed agents rank within their allowed set) — and
    stamps a **"Disk location" header** into each SKILL.md (`applySkillDiskHeader`) —
    the real path is how the agent stops guessing and wandering into other apps' folders.
  - **Connectors**: `listAllConnectors()` (mcp-catalog.ts) = bundled + registry; UI
    renders use the sync `listCachedConnectors()`. Connectors with `customOAuth`
    (Google Workspace) are bring-your-own-client: the user pastes their provider
    OAuth client into the entry (`oauthClientId/Secret`), and sign-in/refresh use
    its fixed endpoints instead of discovery + dynamic registration. Access is hybrid: only the 3 most
    recently used servers connect eagerly (`hotSetMcpServers` → native `mcp__` tools);
    everything else goes through the lazy **`list_mcp_tools` / `call_mcp_tool` proxy**
    (`createMcpProxy` in `src/lib/agent/mcp.ts`, one instance per run) — which is also
    what makes a connector connected mid-run (suggestion card) usable in the same run.
  - Suggestion cards (`src/components/suggestion-card.tsx`) are the connect/install
    UX, generated post-run by the separate suggestion system (never by the agent —
    see `src/lib/agent/suggestions.ts`). Adding skills: Settings → Skills → Add skill
    (GitHub URL / local folder / paste SKILL.md) or Import (one-click from
    `~/.claude/skills`, `~/.config/opencode/skills`, `~/.eigent/skills`).

## Commands

- `npm run dev` — Vite dev server (Tauri dev via `npm run tauri dev`)
- `npm run build` — `tsc && vite build` (the type check)
- `npm test` — vitest run
- `cargo test` in `src-tauri/` — Rust unit tests (network smoke tests are `#[ignore]`)
