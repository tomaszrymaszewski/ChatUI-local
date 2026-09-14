import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { readMcpAuth, hasToken, getAccessToken, isMcpAuthError, beginMcpOauth, type McpAuthData } from "./mcp-auth";

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

describe("beginMcpOauth", () => {
  it("passes no custom fields for standard connectors", async () => {
    mockedInvoke.mockResolvedValueOnce("https://auth.example/authorize");
    await expect(beginMcpOauth("notion", "https://mcp.notion.com/mcp")).resolves.toBe(
      "https://auth.example/authorize",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("mcp_oauth_begin", {
      name: "notion",
      serverUrl: "https://mcp.notion.com/mcp",
      clientId: null,
      clientSecret: null,
      authorizeUrl: null,
      tokenUrl: null,
      scopes: null,
      extraParams: null,
    });
  });

  it("passes the user's client and fixed endpoints for bring-your-own-client connectors", async () => {
    mockedInvoke.mockResolvedValueOnce("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    await beginMcpOauth("gmail", "https://gmailmcp.googleapis.com/mcp/v1", {
      clientId: "abc.apps.googleusercontent.com",
      clientSecret: "shh",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/gmail.modify",
      extraParams: { access_type: "offline" },
    });
    expect(mockedInvoke).toHaveBeenCalledWith("mcp_oauth_begin", {
      name: "gmail",
      serverUrl: "https://gmailmcp.googleapis.com/mcp/v1",
      clientId: "abc.apps.googleusercontent.com",
      clientSecret: "shh",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/gmail.modify",
      extraParams: { access_type: "offline" },
    });
  });
});

describe("isMcpAuthError", () => {
  it("flags rejected-credential failures", () => {
    expect(isMcpAuthError(new Error("Error POSTing to endpoint (HTTP 401): Unauthorized"))).toBe(true);
    expect(isMcpAuthError(new Error("SSE error: 403 Forbidden"))).toBe(true);
    expect(isMcpAuthError(new Error("invalid_token: the access token expired"))).toBe(true);
    expect(isMcpAuthError(new Error("Token has expired, please reauthenticate"))).toBe(true);
    expect(isMcpAuthError("sign-in required")).toBe(true);
  });

  it("ignores network and server failures", () => {
    expect(isMcpAuthError(new Error("MCP connect timeout"))).toBe(false);
    expect(isMcpAuthError(new Error("fetch failed: connection refused"))).toBe(false);
    expect(isMcpAuthError(new Error("Error POSTing to endpoint (HTTP 500): Internal Server Error"))).toBe(false);
    expect(isMcpAuthError(null)).toBe(false);
  });
});
