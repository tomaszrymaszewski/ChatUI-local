import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// Dev-only proxy for web_fetch: a plain browser fetch() is CORS-restricted and
// most websites don't send Access-Control-Allow-Origin. Under Tauri the Rust
// http_fetch command handles this; in vite dev this middleware mirrors it so
// the browser path behaves the same (see src/lib/http-fetch.ts).
const devHttpFetch: Plugin = {
  name: "dev-http-fetch",
  configureServer(server) {
    server.middlewares.use("/__http-fetch", async (req, res) => {
      const params = new URL(req.url ?? "", "http://localhost").searchParams;
      const url = params.get("url") ?? "";
      const timeoutMs = Number(params.get("timeoutMs")) || 15000;
      if (!/^https?:\/\//.test(url)) {
        res.statusCode = 400;
        res.end("Missing or invalid url param");
        return;
      }
      try {
        const resp = await fetch(url, {
          headers: {
            // A real browser UA, same as the Rust side — some sites 403 bot UAs.
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            Accept: "text/html, text/plain, */*",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = Array.from(await resp.text()).slice(0, 500_000).join("");
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: resp.status,
            statusText: resp.statusText,
            contentType: resp.headers.get("content-type") ?? "",
            body,
          }),
        );
      } catch (err) {
        res.statusCode = 502;
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), devHttpFetch],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
