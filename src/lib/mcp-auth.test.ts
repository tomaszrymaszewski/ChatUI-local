import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { readMcpAuth, hasToken, getAccessToken, type McpAuthData } from "./mcp-auth";

const mockedInvoke = vi.mocked(invoke);

const SAMPLE: McpAuthData = {
  supabase: {
    tokens: {
      accessToken: "sb-token",
      refreshToken: "sb-refresh",
      expiresAt: Date.now() / 1000 + 3600,
    },
    serverUrl: "https://mcp.supabase.com/mcp",
  },
  expired: {
    tokens: {
      accessToken: "old-token",
      refreshToken: "old-refresh",
      expiresAt: Date.now() / 1000 - 10,
    },
    serverUrl: "https://example.com/mcp",
  },
  "expired-no-refresh": {
    tokens: { accessToken: "old-token", expiresAt: Date.now() / 1000 - 10 },
    serverUrl: "https://example.com/mcp",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readMcpAuth", () => {
  it("parses the raw JSON returned by the read_mcp_auth command", async () => {
    mockedInvoke.mockResolvedValueOnce(JSON.stringify(SAMPLE));
    await expect(readMcpAuth()).resolves.toEqual(SAMPLE);
    expect(mockedInvoke).toHaveBeenCalledWith("read_mcp_auth");
  });

  it("returns {} when the store is empty", async () => {
    mockedInvoke.mockResolvedValueOnce("");
    await expect(readMcpAuth()).resolves.toEqual({});
  });

  it("returns {} when not running under Tauri", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("not available"));
    await expect(readMcpAuth()).resolves.toEqual({});
  });

  it("returns {} on malformed JSON", async () => {
    mockedInvoke.mockResolvedValueOnce("{not json");
    await expect(readMcpAuth()).resolves.toEqual({});
  });
});

describe("hasToken", () => {
  it("is true only when an access token is stored", () => {
    expect(hasToken(SAMPLE, "supabase")).toBe(true);
    expect(hasToken(SAMPLE, "missing")).toBe(false);
    expect(hasToken(SAMPLE, "zapier")).toBe(false);
  });
});

describe("getAccessToken", () => {
  it("returns the stored token while it is still valid", async () => {
    mockedInvoke.mockResolvedValueOnce(JSON.stringify(SAMPLE));
    await expect(getAccessToken("supabase")).resolves.toBe("sb-token");
    expect(mockedInvoke).toHaveBeenCalledTimes(1); // no refresh call
  });

  it("refreshes an expired token via the Rust command", async () => {
    mockedInvoke
      .mockResolvedValueOnce(JSON.stringify(SAMPLE))
      .mockResolvedValueOnce("fresh-token");
    await expect(getAccessToken("expired")).resolves.toBe("fresh-token");
    expect(mockedInvoke).toHaveBeenCalledWith("refresh_mcp_token", { name: "expired" });
  });

  it("returns null when expired and no refresh token exists", async () => {
    mockedInvoke.mockResolvedValueOnce(JSON.stringify(SAMPLE));
    await expect(getAccessToken("expired-no-refresh")).resolves.toBeNull();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("returns null when the refresh fails", async () => {
    mockedInvoke
      .mockResolvedValueOnce(JSON.stringify(SAMPLE))
      .mockRejectedValueOnce(new Error("refresh rejected"));
    await expect(getAccessToken("expired")).resolves.toBeNull();
  });

  it("returns null for unknown servers", async () => {
    mockedInvoke.mockResolvedValueOnce(JSON.stringify(SAMPLE));
    await expect(getAccessToken("nope")).resolves.toBeNull();
  });
});
