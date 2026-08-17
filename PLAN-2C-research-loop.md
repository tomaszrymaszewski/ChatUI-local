# Deep Research — RESEARCH Step Loop (Phase 2-C core)

This is the inner agent loop. It replaces "one round = one big native-web_search call" with a model-agnostic observe → decide → one action → fold → repeat loop driven by the app's OWN search/fetch tools, so it runs on any connected model with no external API key.

It plugs INTO the existing Phase 1 skeleton — it does not replace it.

## 1. Where this sits (relation to the existing skeleton)

Existing outer state machine (keep as-is):

```
PLAN → RESEARCH → SYNTHESIZE → DONE
                 ▲        │
                 └── reflect (ASSESS gaps)
```

PLAN, SYNTHESIZE, DONE, ResearchSession, MAX_ROUNDS, query dedup, cancellation, progress events, and all termination conditions from Phase 1 are unchanged and wrap this loop.

What changes: the RESEARCH phase is no longer a single model call. It is the step loop below.

Old ASSESS gaps → becomes the reflection checkpoint (§6). A "round" = the interval between two reflections, so MAX_ROUNDS and the round progress events still apply — a round now just contains several steps instead of one call.

"The loop" = the RESEARCH step loop in §4. Everything else is a wrapper.

## 2. Loop contract (invariants — these must always hold)

- One action per iteration. The model emits exactly one JSON action; the orchestrator executes exactly one tool; state advances by one step.
- State is append-only for evidence. sources[], findings[], comparisons[] only ever grow. A later step never rewrites an earlier finding — it adds a new one (possibly contradicting it, which is recorded, not overwritten).
- Plan statuses only move forward. A sub-question goes open → partial → done, never backward.
- Every iteration is cancellable and cannot hard-crash. A tool failure becomes an OBSERVATION, not an exception. An unrecoverable state finalizes a partial report.
- The core is pure. Given (state, modelOutput, toolOutput), the transition is deterministic — so every branch is unit-testable with mocked model + mocked tools.

## 3. Action protocol (model-agnostic — the whole reason it works on any model)

The model returns exactly ONE JSON object per turn, nothing else:

```json
{
  "thought": "what I know and what to do next",
  "action": "web_search | open_url | read_pdf | search_in_page | save_note | compare_sources | calculate | reflect | write_answer",
  "args": {},
  "targets_subq": "id of the sub-question this advances, or null",
  "confidence": 0.0
}
```

No native function-calling. No provider-specific schema. Parse it ourselves → portable across Claude / GPT / Gemini / local Qwen etc.

## 4. ONE ITERATION — the six stages (this is the max-effort part)

Each pass through the RESEARCH loop runs these six stages in order:

### 4.1 Cancellation gate

First line of every iteration: check the abort signal. If aborted → jump to graceful finalize.

The signal must also be able to interrupt an in-flight tool call (fetch/search), not only the gap between steps.

### 4.2 Assemble the turn context (context-window discipline)

Build the model input from state — NOT from full history:

- SYSTEM prompt (constant).
- Compact state summary: goal; plan with per-sub-question status; source index (S1: title (date)… — ids + titles only, not bodies); note digest (last few + count); open gaps; budget (step n of BUDGET).
- Last observation only, raw but truncated (see 4.5 cap).
- EXECUTION phase instruction. Older observations are already compressed into notes; full source bodies live behind search_in_page and are never re-injected. This is what keeps small-context models alive.

### 4.3 Model turn → one action

Call the connected model with the assembled context. Stream nothing to the user here (internal); only progress events (§7) surface.

### 4.4 Parse + validate (retry ladder — never trust raw output)

- Strip ``` fences; extract the first balanced `{…}`.
- Validate: known action; required args present + correct types; targets_subq is a real sub-question id or null; any referenced source_id actually exists in sources[].
- On failure → corrective re-ask: "Your last output was invalid JSON / referenced an unknown source. Reply again with ONLY a valid JSON action." Max 2 retries.
- Retries exhausted → fail forward: synthesize a reflect action. Never throw.

### 4.5 Dispatch the tool (dedup + cache + timeout + error→observation)

Map action → app tool. Every tool call is wrapped:

- Timeout per tool; one retry on transient error; then error becomes a structured OBSERVATION (`{error: "...", suggestion: "reformulate / try another source"}`).
- Dedup (reuse Phase 1):
  - web_search: normalize+hash the query. If already searched → return cached hits plus a flag `already_searched: true` so the model is nudged to reformulate instead of looping.
  - open_url / read_pdf: dedup by normalized URL → return the cached source id, no re-fetch.
- Cache every fetched page body keyed by source id (feeds search_in_page, survives reloads).
- Tool-specific caps: max total fetches, max page-body tokens returned (rest via search_in_page).

### 4.6 Fold result into state

- web_search → push results into a candidate-URL pool (not sources yet).
- open_url / read_pdf → new source `{id, url, title, date, body}` (deduped).
- save_note → append finding `{text, source_ids[], tags}`; validate source_ids exist; if targets_subq set → advance that sub-question open→partial (or →done if the model marks it).
- compare_sources → append comparison; on conflict → push to contradictions[].
- calculate → evaluate in JS (safe evaluator, no eval, no net/fs) → append result.
- Always: step++, per-tool counters++, update diminishing-returns tracker (§6).

Then → stop-condition evaluation (§5) and reflection trigger (§6).

## 5. Termination matrix (extends Phase 1, do not weaken it)

Finish the RESEARCH phase (→ SYNTHESIZE) when ANY holds:

| # | Condition | Source |
|---|---|---|
| 1 | Model emits write_answer AND confidence ≥ CONF_DONE (0.8) AND ≤ MAX_OPEN_ON_FINISH sub-qs still open | new — premature-finalize guard |
| 2 | All sub-questions done (gaps empty) | Phase 1 — kept |
| 3 | step >= STEP_BUDGET | new — graceful forced finalize |
| 4 | Diminishing returns: last K=3 steps added no new source AND no new note | Phase 1 — kept, now measured in steps |
| 5 | Cancellation signalled | Phase 1 — kept |

Condition 1's guard matters: a model can get overconfident early. If confidence ≥ CONF_DONE but too many sub-qs are still open, do not finalize — force one reflect first (§6).

Forced finalize (3) and cancellation (5) both route to SYNTHESIZE with a partial-report flag so the report honestly states what wasn't covered.

## 6. Reflection checkpoint (this is the old ASSESS gaps; rounds emerge here)

Trigger a reflection when ANY holds:

- step % REFLECT_EVERY == 0 (round boundary — REFLECT_EVERY steps ≈ one round), OR
- model emitted reflect, OR
- diminishing-returns tracker tripped (before terminating on it, reflect once to try a new angle).

A reflection is a model turn (REFLECT instruction) that returns either:

- a next research action targeting the biggest gap, or
- write_answer (→ termination condition 1).

At each reflection: emit `round n/MAX_ROUNDS: <current focus>` progress event, and if round > MAX_ROUNDS → force finalize. This is how your existing round UI stays intact.

## 7. Progress events (reuse Phase 1 emitter)

Emit on: step start (🔍 "<query>", 📄 <domain>, 🧮 <calc>), note saved (📝 <subq>), reflection / round boundary (🔄 round n/N: <focus>), termination (✅ writing report / ⚠️ partial report). These drive the existing UI feedback stream.

## 8. Degradation

Any unrecoverable path (retries exhausted twice in a row, all tools failing, budget hit mid-gap) → finalize a partial report with an explicit "could not complete: ..." section. Never crash, never silently drop the run.

## 9. Constants (all named + tunable, like Phase 1)

```ts
STEP_BUDGET          // Quick 6 / Standard 15 / Deep 40
REFLECT_EVERY        // e.g. 4 steps  (≈ one round)
MAX_ROUNDS           // existing, e.g. 5   (round = REFLECT_EVERY steps)
K_DIMINISHING = 3    // no-progress steps before diminishing-returns
CONF_DONE = 0.8
MAX_OPEN_ON_FINISH   // e.g. 1  (premature-finalize guard)
TOOL_TIMEOUT_MS, MAX_FETCHES, MAX_PAGE_TOKENS
```

## 10. Test matrix (extend the existing 10 vitest tests; mock model + tools)

Each of these must have a test:

1. Valid action → correct tool dispatched, state folded, step++.
2. Invalid JSON → retry ladder → recovers on retry.
3. Retries exhausted → falls back to reflect, no throw.
4. Action references unknown source_id → rejected, corrective re-ask.
5. Dedup hit on web_search → cached hits + already_searched flag, model nudged.
6. Dedup hit on open_url → cached source, no second fetch.
7. Diminishing returns (K=3 no-progress) → reflection fired, then terminate if still nothing.
8. STEP_BUDGET reached → forced finalize with partial flag.
9. Premature finalize guard: high confidence + too many open sub-qs → forced reflect, not finish.
10. Cancellation mid-step → aborts, routes to partial finalize.
11. Tool timeout/error → becomes OBSERVATION, loop continues, no crash.
12. Reflection at REFLECT_EVERY → emits round event, advances round counter.

## Stage prompt — implement the RESEARCH step loop

**Role:** Implementing the inner RESEARCH step loop for the Deep Research feature on a fresh branch off `ngo-competitor` (`deep-research-step-loop`). Work in plan mode first; use a todo list; commit per file with a clear message; verify with vitest before declaring done.

**Context:** The Phase 1 orchestrator skeleton (PLAN → RESEARCH → SYNTHESIZE → DONE, ResearchSession model, MAX_ROUNDS, query dedup, cancellation, progress events) does **not** currently exist in this repo — the previous Deep Research implementation was reverted to allow a restart. This stage builds the RESEARCH step loop core in isolation (with injected ports), per §1–§10 above, so it is ready to be wired into a PLAN/SYNTHESIZE skeleton in a later stage.

**Goal:** Implement the model-agnostic step loop from the spec as a pure, testable core, using dependency-injected `ModelPort` / `ToolPort` interfaces — no real network, no real model calls in this stage.

**Scope fence — DO ONLY THIS:**
- Implement the six-stage iteration (§4), the reflection checkpoint (§6), and the extended termination matrix (§5).
- Add the JSON action parser/validator with the retry ladder (§4.4) and the calculate safe evaluator (§4.6).
- Do NOT touch PLAN, SYNTHESIZE, the report template, the UI, or any real tool implementation (web_search/open_url/etc. are ports/interfaces only in this stage). Do NOT add any dependency or network client.

**Hard rules:**
- One action per iteration; evidence state append-only; plan statuses forward-only.
- Every tool call wrapped: timeout + one retry + error→OBSERVATION. No unhandled throw in the loop.
- Cancellation checked at the top of every iteration AND able to interrupt an in-flight tool.
- All constants named and centralised (§9). No magic numbers inline.
- The loop core must be pure over (state, modelOutput, toolOutput) so it is unit-testable with mocks — no real network in tests.

**Engineering techniques (use these):**
- Test-first (TDD): for each of the 12 cases in §10, write the failing vitest test first, then implement to green.
- Discriminated union for actions, exhaustiveness guard (`assertNever`).
- Errors as values (`Result<T, E>`), not throws — no try/catch leaking out of the loop core.
- Pure reducer for state: `foldState(state, action, toolOutput): ResearchSession`, immutable updates.
- Dependency injection / ports: `ModelPort`, `ToolPort` typed interfaces; tests use scripted-sequence fakes.
- `AbortController`/`AbortSignal` threaded into tool calls for real cancellation.
- Injected clock (`now()` param, not `Date.now()` inline) for deterministic tests.
- Hardened JSON parse (no new dep): strip fences, extract first balanced `{…}`, type-predicate guards.
- Strict TS: `strict: true` (already repo default), no `any`, no `!`, branded `SourceId`, `as const` constants.
- Optional dev-dep: `fast-check` for parser fuzzing — only if accepted, else hand-written adversarial cases.

**File order (propose, review, commit each before the next):**
1. `src/lib/research/loop/actions.ts` — action schema + parse/validate + retry ladder.
2. `src/lib/research/loop/calculate.ts` — safe JS evaluator (no eval/net/fs).
3. `src/lib/research/loop/researchLoop.ts` — the six-stage iteration + reflection trigger, ports-based.
4. `src/lib/research/loop/researchLoop.test.ts` — the 12 tests in §10 (mock model + tools).

**Verification:** vitest set up fresh (no existing test runner in this repo state — needs `vitest` devDependency + config as part of this stage); all new tests green; run the loop against a stubbed model that returns a scripted action sequence and confirm the progress-event stream and a partial-finalize path both fire.

**Done when:** §10 tests pass, no new runtime deps (vitest as a dev-only test runner is expected), loop runs end-to-end on stubs with correct termination, and a diff summary is posted for gate review.
