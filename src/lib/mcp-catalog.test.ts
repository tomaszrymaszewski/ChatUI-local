import { describe, expect, it } from "vitest";
import { customOAuthArgsFor, listCachedConnectors, type McpCatalogEntry } from "./mcp-catalog";

const baseEntry: McpCatalogEntry = {
  id: "gmail",
  name: "Gmail",
  tagline: "Mail.",
  category: "Productivity",
  vendor: "Google",
  auth: "oauth",
  keywords: ["gmail"],
  install: { type: "remote", url: "https://gmailmcp.googleapis.com/mcp/v1" },
  customOAuth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: "https://www.googleapis.com/auth/gmail.modify",
    extraParams: { access_type: "offline" },
    setupUrl: "https://console.cloud.google.com/auth/clients",
    setupHint: "Hint.",
  },
};

describe("customOAuthArgsFor", () => {
  it("builds sign-in args from the catalog config and stored credentials", () => {
    expect(customOAuthArgsFor(baseEntry, "id123", "shh")).toEqual({
      clientId: "id123",
      clientSecret: "shh",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/gmail.modify",
      extraParams: { access_type: "offline" },
    });
  });

  it("omits the secret and extra params when absent", () => {
    const { customOAuth, ...rest } = baseEntry;
    expect(
      customOAuthArgsFor(
        { ...rest, customOAuth: { ...customOAuth!, extraParams: undefined } },
        "id123",
        undefined,
      ),
    ).toEqual({
      clientId: "id123",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/gmail.modify",
    });
  });

  it("returns undefined without a catalog config or stored client", () => {
    const { customOAuth, ...rest } = baseEntry;
    expect(customOAuthArgsFor(rest, "id123", "shh")).toBeUndefined();
    expect(customOAuthArgsFor(baseEntry, undefined, undefined)).toBeUndefined();
    expect(customOAuthArgsFor(baseEntry, "", "shh")).toBeUndefined();
  });
});

describe("connector catalog", () => {
  it("keeps Zapier for apps without official connectors", () => {
    const byId = new Map(listCachedConnectors().map((e) => [e.id, e]));
    expect(byId.has("zapier")).toBe(true);
  });
});
