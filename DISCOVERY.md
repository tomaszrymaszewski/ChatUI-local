# DISCOVERY.md — Deep Research feature

Phase 0 discovery only. No code changed. Branch: `feat/deep-research` (cut off `ngo-competitor`, currently identical — `git diff ngo-competitor...feat/deep-research` is empty).

## Gate resolutions (decided, carrying into Phase 1+)

1. **Key handling — match existing app pattern.** Deep Research calls Anthropic (with `web_search`) directly from React via `fetch()`, using the same `localStorage`-stored key mechanism the rest of the app already uses. No new Rust routing for this feature.
2. **Tool version — `web_search_20250305`.** Basic search, broad model compatibility, no code-execution provisioning.
3. **Engine model is decoupled from the chat model selector.** Deep Research does **not** inherit `selectedModel` from the chat UI (that could be a non-Claude or local Ollama model, which can't run `web_search`). It always runs on a fixed, named-constant Claude model, independent of whatever the user has picked for normal chat. Both the tool-version string and the engine model ID live in named config constants (e.g. `RESEARCH_MODEL`, `WEB_SEARCH_TOOL_TYPE`) so bumping either later is a one-line change.
   - **Consequence to design for in Phase 1/2:** the key lookup must specifically find the user's **Claude/Anthropic** provider entry in `localStorage` (via `getProviderApiKey`/provider list), regardless of which provider is active in the chat model selector. If no Claude provider + key is configured at all, Deep Research must fail with a clear "add a Claude API key in Settings" message, not a silent/generic error — flagging this now so Phase 4's UX work accounts for it.

## ⚠️ Plan conflict — resolved above, kept for record

The plan assumes there's already a server-side (Rust/env) key store and says to route research through Rust "to keep keys off the client." **That's not how this app works today.**

Today, for every provider including Anthropic:
- API keys are typed into a form (`src/components/provider-form.tsx`) and saved as **plaintext JSON in browser `localStorage`** (`chatui:providers`, see `src/lib/llm.ts:6-29`).
- The LLM call itself — including the existing Anthropic call (`src/lib/providers/anthropic.ts:129-288`) — is a plain `fetch()` **from the React/JS side**, straight to `api.anthropic.com`, with the key attached client-side (`x-api-key` header).
- Rust/Tauri is not involved in any LLM request at all today. Its only outbound HTTP call is a local health-check ping. There is no env-var key store, no Rust secret handling, nothing to "reuse."

So there are two real options for Deep Research, and they trade off differently:

1. **Match the existing app pattern** — keep using the browser-stored key, call `web_search` directly from JS via `fetch()`, same as the current Anthropic path. Minimal new surface, consistent with how the rest of the app already handles every provider's keys. But it does *not* satisfy the plan's literal "keys never bundled into the frontend" rule — because nothing in this app does today.
2. **Build a new Rust-side secret path just for this feature** — add a Tauri command that owns the Anthropic key (e.g. read from an OS env var or a new encrypted store) and makes the `web_search` call from Rust, streaming results back via Tauri events. This satisfies the plan's rule, but it's a real architecture change: new key storage/entry UX just for this one feature, a new Rust HTTP+streaming path, and an inconsistency where Deep Research protects its key differently than every other model call in the app.

I'm not picking one silently since this is exactly the kind of fork-in-the-road the plan says to stop and report. See the question below.

---

## 1. Model layer

- No official provider SDKs anywhere (`@anthropic-ai/sdk`, `openai`, etc. are not installed — checked `package.json`, lockfiles, `node_modules`, `Cargo.lock`). All calls are hand-rolled `fetch()` / `reqwest`.
- Provider config type: `src/types.ts:62-69` — `Provider { id, name, baseUrl, models, hasKey, builtinKey }`.
- Built-in provider presets (base URLs only): `src/lib/builtin-providers.ts:8-51` — `claude` → `https://api.anthropic.com/v1`, plus `chatgpt`, `gemini`, `fireworks`, `deepinfra`, `ollama` (local), `custom`. No model IDs are hardcoded here — models are fetched/entered per provider, so Deep Research doesn't need to hardcode a Claude model ID either; it can reuse whatever Claude model the user already has configured.
- Provider CRUD + `localStorage` persistence: `src/lib/llm.ts:1-177` (`STORAGE_KEY = "chatui:providers"`, `loadProviders`/`saveProviders` at lines 17-29, `getProviderApiKey()` at 94-101).
- Generic OpenAI-compatible streaming call: `streamChatCompletion()`, `src/lib/llm.ts:278-451`.
- Anthropic-specific adapter (used when `baseUrl.includes("anthropic.com")`): `streamAnthropicCompletion()`, `src/lib/providers/anthropic.ts:129-288`.
- **API keys are 100% frontend-side**, plaintext in `localStorage`. No env vars used anywhere in `src/` (checked `import.meta.env`, `process.env`, `VITE_*`, `.env*`).

## 2. Anthropic `web_search` availability → **Path A confirmed viable**

- The app already calls the real Anthropic Messages API directly with a live key over `fetch()` (`anthropic.ts:138-164`), pinned `anthropic-version: 2023-06-01`. No SDK, no proxy in the way — request bodies are hand-built JSON, so adding a server-side tool is just adding an object to `body.tools`.
- **Verified against current docs (platform.claude.com, fetched today):**
  - Tool type/name: `{"type": "web_search_20250305", "name": "web_search"}` is the basic, broadly-model-compatible version. Two newer versions exist — `web_search_20260209` (adds dynamic filtering, needs Claude 4.6+) and `web_search_20260318` (adds `response_inclusion` control) — but they pull in extra behavior (auto-provisioned code execution, `allowed_callers` defaults) not needed for a straightforward research loop. **Recommend `web_search_20250305`** for Phase 2 unless we specifically want dynamic filtering later.
  - Supports `max_uses`, `allowed_domains`/`blocked_domains`, `user_location`.
  - Response adds `server_tool_use` (the query) and `web_search_tool_result` (results with `url`, `title`, `encrypted_content`) content blocks, plus `citations` on text blocks — this is where the report's per-claim source URLs come from.
  - No beta header required; uses the same `anthropic-version: 2023-06-01` the app already sends.
  - Streaming emits the same block/delta events the app's SSE parser already handles the shape of (`content_block_start`/`delta`), just with new block types (`server_tool_use`, `web_search_tool_result`) that the current parser doesn't yet branch on — see Q4.

## 3. Network boundary

- All external calls (LLM, weather tool, web_fetch tool, Ollama tags) go straight from React/JS via `fetch()`. **Nothing routes through Tauri today.**
- Tauri `invoke()` is used only for local filesystem/session-metadata/OpenCode-server plumbing (`src-tauri/src/lib.rs:74-720`), registered in `generate_handler!`. Rust's only outbound HTTP call is a local health-check `reqwest::blocking` GET (`lib.rs:322-330`).
- Reference pattern for "the existing chat completion call": `streamChatCompletion()` (`llm.ts:278`) → `streamAnthropicCompletion()` (`anthropic.ts:129`), both plain async generators doing `fetch(url, { method: "POST", headers, body, signal })` and manually parsing SSE.

## 4. Streaming

- Entirely browser-side: `fetch()` → `response.body.getReader()` → manual SSE parsing → JS async generator → consumed in a `for await` loop → `setState` per chunk → React re-render.
- Anthropic path specifics: `anthropic.ts:172` (`getReader()`), `anthropic.ts:191-199` (SSE `event:`/`data:` parsing on `\n\n`-split buffer), `anthropic.ts:219-223` (`content_block_delta` → yields `{ content }` for `text_delta`, `{ reasoning }` for `thinking_delta`).
- Consumer: `handleSend()` in `src/components/ChatView.tsx:464-481` — `for await (const chunk of streamChatCompletion(...))`, accumulates into `fullResponse`, calls `setStreamingContent(fullResponse)` (`ChatView.tsx:475`) each chunk.
- Render sink: `<MarkdownRenderer content={streamingContent} />` (`ChatView.tsx:1253`). On completion, persisted via `addMessage(...)` (`ChatView.tsx:493`), then streaming state cleared.
- **This is the primitive Deep Research will reuse**: same `setStreamingContent` + `MarkdownRenderer` + `addMessage` flow for the final synthesis stream; progress events (`planning`, `round 2/5`, etc.) will need a small addition alongside it (e.g. a separate `researchStatus` state rendered above the streaming markdown) since nothing like that exists yet.
- Rust/Tauri emits no events into this path at all today (its `Emitter` usage is only for project-scaffold progress, unrelated).

## 5. The Deep Research button

- **Does not exist yet.** Exhaustive grep (case-insensitive, all `*.ts/tsx/rs/json/md`) for "deep research" / "deep-research" / "deepresearch" → zero matches anywhere in the repo.
- Closest existing thing: a **"Research" mode toggle** (`ChatView.tsx:1391-1401` and `:1851-1861`, state `isResearch` at `:215`) — this is *not* a placeholder, it already does something: when on, it prepends a static `RESEARCH_PROMPT` string (`ChatView.tsx:179-180`) to instructions before sending, telling the model to use the existing client-side `web_fetch` tool and cite URLs. It does not add rounds, a planner, or a synthesis step — just a system-prompt nudge on top of the normal single-pass send. This is a different, existing feature; Deep Research is new and separate per the plan, so we should not repurpose this toggle, just possibly sit next to it in the UI.
- There's an existing "coming soon" placeholder pattern (`const comingSoon = (feature: string) => toast(...)`, `ChatView.tsx:303`) that's currently unused — worth knowing about as the likely stand-in if a Deep Research button placeholder already existed, but it doesn't.
- Chat input text: `inputText` state, `ChatView.tsx:202`, bound to the textarea at `:1313`/`:1772`, read as `inputText.trim()` in `handleSend()` (`:363`). A Deep Research button can read this same state for "the NGO/competitor name."

## 6. State/history

- No Redux/Zustand/Context store. Plain React `useState` in `src/hooks/use-messages.ts`, persisted per-session to `localStorage` (`` `chatui:messages:${sessionId}` ``).
- Message shape: `src/types.ts:1-22` — `Message { id, role, content, timestamp, model?, attachments?, session_id?, parent_id?, is_temporary?, reasoning? }`. Messages form a tree via `parent_id` (edit/regenerate branches), flattened by `buildMessageTree()`/`getActivePath()` (`src/lib/message-tree.ts:8-53`).
- Append function: `addMessage(sessionId, role, content, model?, attachments?, parentId?, isTemporary?, reasoning?)` (`use-messages.ts:75-107`) — updates React state and `localStorage` together.
- Where it's called after a stream finishes: `ChatView.tsx:493` — `addMessage(sessionId, "assistant", fullResponse, selectedModel, undefined, userMsg.id, isTemporary, fullReasoning)`. **The Deep Research report will land here the same way** — same function, same shape, `content` = the final markdown report.
- Session metadata (title/timestamps, not message bodies) is separately mirrored to Rust-side JSON files (`src-tauri/src/lib.rs:610-684`) — irrelevant to report storage itself.

---

## Summary for the gate

- **Path A (Anthropic `web_search`) is confirmed viable and is what I'd recommend** — the app already speaks raw Anthropic REST with a live key; adding `{"type": "web_search_20250305", "name": "web_search"}` to `tools` is a small, additive change to `anthropic.ts`, not a new integration. No need for Path B (Tavily/Brave) unless you want a non-Anthropic-key fallback.
- **The Rust-routing question above is the real open item.** Everything else in the plan lines up cleanly with what exists (streaming primitive, message append, input state all reusable as described).
