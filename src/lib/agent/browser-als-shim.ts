// Browser fallback for LangChain's AsyncLocalStorage-based runnable context.
//
// deepagents' `task` (subagent) tool reads the parent run's state via
// `getCurrentTaskInput()` with no arguments, which resolves the current
// RunnableConfig from AsyncLocalStorage. Node provides that
// (node:async_hooks, installed by @langchain/core on import); browsers —
// including the Tauri WKWebView this app runs in — do not, so every
// subagent spawn throws "Config not retrievable. ... Subagents do not work."
//
// True async context tracking is impossible in browsers, but we don't need
// it: every `tool()` invocation wraps the tool function in
// `runWithConfig(childConfig, ...)`, and the task tool reads the config
// synchronously before its first await. So a minimal store that holds the
// config for the synchronous span of `run()` is enough to make that read
// (and every other synchronous read) behave exactly like Node.
//
// The restore in `finally` is the load-bearing part: async continuations
// keep seeing `undefined`, exactly as with LangChain's MockAsyncLocalStorage.
// A never-restore global would leak stale configs across runs — e.g. the
// previous run's callbacks merged into the next top-level run by
// `ensureLangGraphConfig` — and across concurrent runs (interactive +
// headless). This shim cannot do that: nothing survives past the sync span.
//
// No-op in Node: the real AsyncLocalStorage instance is already installed
// there, so `ensureBrowserAsyncLocalStorage()` leaves it alone.

import {
  AsyncLocalStorageProviderSingleton,
  MockAsyncLocalStorage,
  type AsyncLocalStorageInterface,
} from "@langchain/core/singletons";

class SyncScopedAsyncLocalStorage implements AsyncLocalStorageInterface {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any | undefined = undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStore(): any | undefined {
    return this.store;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run<T>(store: any, callback: () => T): T {
    const prev = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      // Restore as soon as the synchronous span ends (callback() returns
      // its promise here for async callbacks) — async continuations must
      // not observe this config.
      this.store = prev;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enterWith(store: any): void {
    this.store = store;
  }
}

/**
 * Install the sync-scoped AsyncLocalStorage fallback when no real one is
 * present (browsers). Safe to call on every session creation; a no-op
 * wherever the real node:async_hooks instance is installed.
 */
export function ensureBrowserAsyncLocalStorage(): void {
  if (
    AsyncLocalStorageProviderSingleton.getInstance() instanceof
    MockAsyncLocalStorage
  ) {
    AsyncLocalStorageProviderSingleton.initializeGlobalInstance(
      new SyncScopedAsyncLocalStorage(),
    );
  }
}
