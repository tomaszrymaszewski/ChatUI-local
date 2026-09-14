import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { htmlToText, looksBlocked } from "./http-fetch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

async function freshHttpFetch() {
  vi.resetModules();
  return import("./http-fetch");
}

function htmlResponse(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(invoke).mockReset();
});

describe("looksBlocked", () => {
  it("flags challenge statuses even with a body", () => {
    expect(looksBlocked(202, "<html>results</html>")).toBe(true);
    expect(looksBlocked(403, "<html>results</html>")).toBe(true);
    expect(looksBlocked(429, "<html>results</html>")).toBe(true);
  });

  it("flags empty bodies", () => {
    expect(looksBlocked(200, "")).toBe(true);
    expect(looksBlocked(200, "   ")).toBe(true);
  });

  it("flags bot-interstitial markers", () => {
    expect(looksBlocked(200, "<div class='anomaly-modal'>x</div>")).toBe(true);
    expect(looksBlocked(200, "<div id='challenge-platform'>x</div>")).toBe(true);
    expect(looksBlocked(200, "please enable javascript to see content")).toBe(true);
  });

  it("passes real content through", () => {
    expect(looksBlocked(200, "<html><body><p>hello world</p></body></html>")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles, and tags while decoding entities", () => {
    const text = htmlToText(
      "<html><head><style>.x{}</style><script>alert(1)</script></head>" +
        "<body><nav>menu</nav><p>fish &amp; chips&nbsp;here</p></body></html>",
    );
    expect(text).toBe("fish & chips here");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("menu");
  });
});

describe("fetchPageText", () => {
  it("returns plain-HTTP text without invoking the browser", async () => {
    const mod = await freshHttpFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<html><body><p>plain hello</p></body></html>")),
    );
    const text = await mod.fetchPageText("https://example.com/");
    expect(text).toBe("plain hello");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("re-renders via headless Chrome when plain HTTP is challenged", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshHttpFetch();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "http_fetch") {
        return {
          status: 202,
          statusText: "Accepted",
          contentType: "text/html",
          body: "<html><body><div class='anomaly-modal'>x</div></body></html>",
        };
      }
      return {
        status: 200,
        statusText: "OK",
        contentType: "text/html",
        body: "<html><body><p>rendered hello</p></body></html>",
      };
    });
    const text = await mod.fetchPageText("https://example.com/");
    expect(text).toBe("rendered hello");
    expect(invoke).toHaveBeenCalledWith("browser_fetch", {
      url: "https://example.com/",
      timeoutMs: 30000,
    });
  });

  it("returns an error string when both transports fail", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshHttpFetch();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "http_fetch") throw new TypeError("network down");
      throw new Error("No Chrome/Chromium browser found");
    });
    const text = await mod.fetchPageText("https://example.com/");
    expect(text.startsWith("Error:")).toBe(true);
    expect(text).toContain("No Chrome/Chromium browser found");
  });
});
