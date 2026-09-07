import { describe, expect, it } from "vitest";
import { apiKeyHeadersForEntry } from "./mcp";

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
