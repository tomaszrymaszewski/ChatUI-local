# DISCOVERY-2C.md — Phase 2-C Stage 0: capability verification

Stage 0 only. No code changed. Answers below are from reading the actual current code (`src/lib/tools.ts`, `src/lib/mcp-catalog.ts`, `src/lib/attachment-context.ts`, `src/lib/files.ts`, `src/components/ChatView.tsx`), not assumption.

## 1. Does a search tool exist? → **No. Fetch-only. 🛑**

Exhaustive check of every tool the app can call (`src/lib/tools.ts`, the only tool registry — confirmed via `getAllTools()`):
- `get_current_time`, `get_current_date`, `get_weather` (always-on)
- `web_fetch` (toggleable) — **URL → content only.** Signature: `executeWebFetch({ url: string }): Promise<string>`. There is no query-in, URLs-out function anywhere in this codebase.

I also checked the MCP marketplace (`src/lib/mcp-catalog.ts`, a "Search & Research" category exists there) in case a search capability is available through that mechanism instead: **Exa** and **Firecrawl** are listed, but both are optional, user-installed MCP servers that each require their own external API key (`EXA_API_KEY`, `FIRECRAWL_API_KEY`) — neither is installed or configured by default. This is the exact same external-dependency problem Tavily had; it isn't "the app's own search," it's a different external service with a different key. **Microsoft Learn** is free/keyless but scoped only to Microsoft's own documentation — useless for NGO research.

**This is the stop condition the plan called out.** There is no query→URLs discovery mechanism anywhere in this app, built-in or otherwise, that doesn't require a new external API key. `web_fetch` can only read a URL you already have — it can't find one.

## 2. `web_fetch` signature & limits

- `executeWebFetch(args: { url: string }): Promise<string>` (`src/lib/tools.ts:195-235`)
- Strips `<script>`/`<style>`/`<nav>`/`<footer>`/`<header>` and all remaining tags from HTML responses, collapses whitespace
- **Truncates to 8000 characters** (`text.slice(0, 8000)`) — both for HTML and plain-text responses
- 15-second timeout (`AbortSignal.timeout(15000)`)
- Returns a plain `Error: ...` string (not a thrown exception) on failure — the caller has to check for that prefix, there's no structured error type

## 3. Invocation model — plain callables, confirmed

`executeTool(call: ToolCall): Promise<ToolResult>` is exported and is a plain async function — it dispatches on `call.name` via a switch statement and does **not** require going through a model's tool-calling loop. The orchestrator can call it directly:
```ts
await executeTool({ id: crypto.randomUUID(), name: "web_fetch", arguments: JSON.stringify({ url }) });
```
This works today with zero changes — confirms the plan's "orchestrator-driven, injected, not model-invoked" design is achievable for fetch. (The individual `executeGetWeather`/`executeWebFetch` functions themselves aren't exported, only the `executeTool` dispatcher — that's fine, it's the intended entry point.)

## 4. Upload support — yes, already robust

The app already has a full local pipeline for turning an uploaded file into text, used today for normal chat attachments:
- `PendingFile = MessageAttachment & { file?: File }`, held in `ChatView`'s existing `files` state (`useState<PendingFile[]>([])`) — **the same staged-before-send state `inputText` already lives alongside**, populated by the existing `handleFiles` handler. Deep Research can read this the same way it already reads `inputText`.
- `extractFileText(file: File): Promise<string>` (`src/lib/files.ts:42-57`) — plain exported callable, handles:
  - Text-like files (md/txt/code files/etc., by extension or MIME type) — read directly
  - PDF — via `pdfjs-dist` (already a dependency)
  - DOCX — via `mammoth` (already a dependency)
  - Returns `""` for unsupported types (e.g. `.xlsx`, images) rather than throwing
- `src/lib/attachment-context.ts` additionally has chunking + local embedding + cosine-similarity retrieval (`chunkText`, `embed`/`embedQuery` via `@huggingface/transformers`, running fully local) for documents too large to inline — this is a whole existing local RAG layer, not something Stage 1 needs to build. For Deep Research's seed use case specifically, we probably want the **full extracted text**, not a query-ranked top-K excerpt (a competitor report should be read in full as grounding, not fuzzy-matched against a short query) — worth deciding in Stage 1 whether to reuse `extractFileText` alone (full text) or the whole `prepareAttachmentContext` pipeline (chunked/ranked). No URL-list-as-seed parser exists yet — Stage 1 would need to add: given a block of pasted/uploaded URLs, fetch each via `executeTool("web_fetch", ...)` from #3 above.

## Bottom line — decision needed before Stage 1

Per the plan's own stop condition: **typed-topic mode cannot work without a real search tool**, and none exists in this app without adding a new external API key (Exa/Firecrawl are no different from Tavily in that respect). Upload mode, by contrast, is fully viable today with zero new dependencies — extract the seed doc's text, fetch any URLs it contains via the existing `web_fetch`, no search needed.

I'm stopping here per the GATE, per your STAGE 0 instruction, and per the plan's own explicit rule. This needs your call:

1. **Upload-only** — cut typed-topic mode entirely (or keep it as "instructions/context" but require a seed doc/URL to actually anchor the research, since there's nothing to search from a bare name). Zero new external keys, ships fastest.
2. **Keep a search key, but make it optional/last-resort** — e.g. only require Tavily/Exa/Firecrawl when the user picks typed-topic mode with no seed; upload mode still needs nothing extra. Keeps the topic-only flow you originally wanted, at the cost of reintroducing exactly the external-dependency problem this plan set out to remove.
3. **Something else** — tell me.
