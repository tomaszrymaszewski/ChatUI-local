# CLAUDE.md — Working rules for ChatUI-local

Persistent instructions for Claude Code on this repo. Keep changes tightly scoped.
Detailed fixes live in `IMPROVEMENT_PLAN.md` (stages 1–6). This file governs *how* to work.

## What this repo is

Two apps in one Tauri + React 19 + TypeScript + Tailwind + shadcn/ui shell:
- **Chat half** — `src/components/ChatView.tsx`, talks to OpenAI-compatible provider APIs,
  persists via **Supabase** (`src/lib/supabase.ts`, `src/hooks/use-*.ts`, `src/lib/llm.ts`).
- **Agent half** — `src/components/AgentView.tsx` + `src/hooks/use-opencode.ts`
  + `src/lib/opencode.ts`, talks to a local **OpenCode server** over REST + SSE.

The two halves are separate. A change to one must not touch the other unless a stage says so.

## Global working rules

1. **One stage at a time.** Do exactly the requested stage. Never combine stages.
2. **Only touch the allowed files** listed for that issue below. If a fix seems to need a
   file outside the allowed list, STOP and tell me why before editing it.
3. **Never touch the "Do NOT touch" files** for the current issue.
4. **Always end with:** run `npm run build` (the TypeScript check), then show the full diff
   and explain each change *before* I accept anything.
5. **No refactors, renames, dependency changes, or reformatting** unless explicitly asked.
   Match the existing code style in each file exactly.
6. **Ask, don't assume.** If an API endpoint or type is uncertain, verify it (server docs /
   the codebase) and tell me what you found — do not guess and move on.
7. **Dev auth bypass stays OFF before any commit.** The `VITE_DEV_BYPASS_AUTH` flag and its
   gate in `App.tsx` are local-only; never commit them enabled.

## Global do-NOT-touch (all early stages)

- `src/lib/supabase.ts`, `src/lib/auth.tsx` — auth/backend wiring.
- `src/App.tsx` routing — except the existing dev-bypass gate, which must not be committed on.
- Anything under `src-tauri/` — the Rust shell.
- `package.json` / lockfile — no dependency changes unless a stage requires one and I approve.

---

## Scope map (per issue)

### Issue 1 & 3 — Agent send/stop bugs + flaky start (do together)
- **Target:** SSE subscription, `isBusy`, reasoning rendering, new-session send, abort.
- **Allowed files:** `src/hooks/use-opencode.ts`, `src/components/AgentView.tsx`.
  (May add an *optional* `sessionId` param to `sendMessageAsync` in `src/lib/opencode.ts`
  only if truly needed — ask first.)
- **Do NOT touch:** `ChatView.tsx`, `src/lib/llm.ts`, any `use-*` Supabase hook,
  the API-client functions in `opencode.ts` beyond the optional param above.

### Issue 2 — Large / real files don't send in chat
- **Target:** `handleFiles` + `handleSend` (attachment content is currently never read/sent).
- **Allowed files:** `src/components/ChatView.tsx`, `src/lib/llm.ts`
  (message-content typing + `streamChatCompletion`), `src/types.ts` (attachment type only).
- **Do NOT touch:** any agent file (`AgentView.tsx`, `use-opencode.ts`, `opencode.ts`),
  settings, auth.

### Issue 4 — Chat & agent settings
- **Target:** add "Chat" and "Agent" tabs to the settings dialog.
- **Allowed files:** `src/pages/settings.tsx`, `src/hooks/use-user-settings.ts` (chat prefs),
  `src/lib/opencode.ts` (reuse `getStoredConfig`/`saveConfig` pattern for agent settings).
- **Do NOT touch:** the Providers tab CRUD logic, `ChatView.tsx` send flow,
  `AgentView.tsx` message rendering. Persist agent settings to localStorage, NOT Supabase.

### Issue 5 — Compaction (button + automatic)
- **Target:** add a summarize/compact call, a Compact button, and an auto-trigger.
- **Allowed files:** `src/lib/opencode.ts` (add `summarizeSession`),
  `src/hooks/use-opencode.ts` (summarize action + auto-trigger),
  `src/components/AgentView.tsx` (Compact button in the session header).
- **Do NOT touch:** the chat side, provider config.
- **Note:** confirm the real summarize endpoint from the OpenCode server API before coding.

### Issue 6 — Unify model selection (do last)
- **Target:** one shared model picker used by both Chat and Agent; agent passes its model.
- **Allowed files:** new `src/components/model-picker.tsx`, `src/components/ChatView.tsx`
  (wire picker, no behavior change), `src/components/AgentView.tsx` (wire picker + pass model
  into `sendMessageAsync`), `src/lib/opencode.ts` (use `getConfigProviders`).
- **Do NOT touch:** provider CRUD, Supabase schema. Do NOT merge the two provider backends —
  UI unification only; list follow-ups for me to decide separately.

---

## Order

1 & 3 (agent core) → 5 (compaction) → 4 (settings) → 6 (models) → 2 (chat files).
Start narrow (reasoning visibility, `AgentView.tsx` only) before the structural agent work.
