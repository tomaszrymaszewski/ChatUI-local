import { describe, expect, it } from "vitest";
import { OAUTH_REDIRECT_TO, parseOAuthCallback } from "@/lib/oauth-callback";

describe("parseOAuthCallback", () => {
  it("extracts the PKCE code from the full redirect URL", () => {
    expect(parseOAuthCallback(`${OAUTH_REDIRECT_TO}?code=abc123`)).toEqual({
      code: "abc123",
    });
  });

  it("extracts the PKCE code from the bare request target", () => {
    expect(parseOAuthCallback("/auth/callback?code=abc123")).toEqual({
      code: "abc123",
    });
  });

  it("extracts error callbacks with their description", () => {
    expect(
      parseOAuthCallback(
        "/auth/callback?error=access_denied&error_description=User+denied+access",
      ),
    ).toEqual({ error: "access_denied", description: "User denied access" });
  });

  it("returns null when there are no OAuth params", () => {
    expect(parseOAuthCallback("/auth/callback")).toBeNull();
    expect(parseOAuthCallback("/favicon.ico")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseOAuthCallback("http://[::1")).toBeNull();
  });
});
