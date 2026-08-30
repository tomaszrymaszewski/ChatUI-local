// Minimal `process` shim for the browser.
// deepagents' bundled `micromatch` (picomatch) reads `process.platform` and
// `process.version` at module scope, which crashes with "process is not
// defined" in the browser before the app can render. Guarded `process.env`
// reads elsewhere in the bundle tolerate an empty env object.
// This file must be imported before any other module in `main.tsx`.

const g = globalThis as Record<string, unknown>;

if (typeof g.process === "undefined") {
  g.process = {
    platform: "browser",
    version: "v18.0.0",
    env: {},
  };
}

export {};
