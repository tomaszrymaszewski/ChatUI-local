import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { apiKeyHeadersForEntry, corsFreeMcpFetch } from "./mcp";

const mockedInvoke = vi.mocked(invoke);

describe("apiKeyHeadersForEntry", () => {
  it("sends the Exa key raw in x-api-key", () => {
    expect(
      apiKeyHeadersForEntry("exa", {
        type: "remote",
        url: "https://mcp.exa.ai/mcp",
        environment: { EXA_API_KEY: "  exa-key-1 " },
        addedAt: "",
      }),
    ).toEqual({ "x-api-key": "exa-key-1" });
  });

  it("defaults unknown servers to a Bearer Authorization header", () => {
    expect(
      apiKeyHeadersForEntry("custom", {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        environment: { API_KEY: "secret" },
        addedAt: "",
      }),
    ).toEqual({ Authorization: "Bearer secret" });
  });

  it("does not double-prefix an already-prefixed value", () => {
    expect(
      apiKeyHeadersForEntry("custom", {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        environment: { API_KEY: "Bearer secret" },
        addedAt: "",
      }),
    ).toEqual({ Authorization: "Bearer secret" });
  });

  it("returns no headers without a stored key", () => {
    expect(
      apiKeyHeadersForEntry("exa", {
        type: "remote",
        url: "https://mcp.exa.ai/mcp",
        addedAt: "",
      }),
    ).toEqual({});
    expect(
      apiKeyHeadersForEntry("exa", {
        type: "remote",
        url: "https://mcp.exa.ai/mcp",
        environment: { EXA_API_KEY: "   " },
        addedAt: "",
      }),
    ).toEqual({});
  });
});

describe("corsFreeMcpFetch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("answers the GET stream probe with a synthetic 405 and never invokes Rust", async () => {
    const fetch = corsFreeMcpFetch();

    const resp = await fetch("http://localhost:8931/mcp", { method: "GET" });

    expect(resp.status).toBe(405);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes POSTs through mcp_http_post and rebuilds the Response", async () => {
    mockedInvoke.mockResolvedValueOnce({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "mcp-session-id": "abc-123",
      },
      body: "event: message\ndata: {\"jsonrpc\":\"2.0\"}\n\n",
    });
    const fetch = corsFreeMcpFetch();

    const resp = await fetch("http://localhost:8931/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(mockedInvoke).toHaveBeenCalledWith("mcp_http_post", {
      url: "http://localhost:8931/mcp",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      headers: expect.objectContaining({
        "content-type": "application/json",
        "mcp-protocol-version": "2025-03-26",
      }),
      timeoutMs: 300_000,
    });
    // Session id and content-type must survive so the SDK can resume the
    // session and pick the SSE parser.
    expect(resp.status).toBe(200);
    expect(resp.headers.get("mcp-session-id")).toBe("abc-123");
    expect(resp.headers.get("content-type")).toBe("text/event-stream");
    await expect(resp.text()).resolves.toContain("event: message");
  });

  it("forwards DELETE (session termination) through the proxy", async () => {
    mockedInvoke.mockResolvedValueOnce({ status: 200, headers: {}, body: "" });
    const fetch = corsFreeMcpFetch();

    const resp = await fetch("http://localhost:8931/mcp", {
      method: "DELETE",
      headers: { "mcp-session-id": "abc-123" },
    });

    expect(mockedInvoke).toHaveBeenCalledWith("mcp_http_post", expect.objectContaining({
      url: "http://localhost:8931/mcp",
    }));
    expect(resp.status).toBe(200);
  });

  it("propagates transport errors (server down) as fetch failures", async () => {
    mockedInvoke.mockRejectedValueOnce("Connection refused");
    const fetch = corsFreeMcpFetch();

    await expect(
      fetch("http://localhost:8931/mcp", { method: "POST", body: "{}" }),
    ).rejects.toBe("Connection refused");
  });
});
