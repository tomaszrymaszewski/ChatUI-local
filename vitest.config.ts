import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// *.live.test.ts hits the real Anthropic API and costs real money. It's
// excluded unless RUN_LIVE_TESTS is explicitly set — deliberately not just
// "has ANTHROPIC_API_KEY", since a dev may have that exported for unrelated
// tools and `npm test` should never spend money by surprise.
const liveTestExclude = process.env.RUN_LIVE_TESTS ? [] : ["**/*.live.test.ts"];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", ...liveTestExclude],
  },
});
