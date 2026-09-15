import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabase, resetSupabaseClient } from "@/lib/supabase";

describe("supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSupabaseClient();
  });

  it("uses PKCE so OAuth returns a query code the loopback listener can see", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-key");
    const client = getSupabase();
    // Implicit flow (the library default) hides tokens in the URL fragment,
    // which browsers never send to a server — the callback would arrive
    // empty. PKCE returns `?code=`, which the Rust listener captures.
    expect(
      (client.auth as unknown as { flowType: string }).flowType,
    ).toBe("pkce");
  });
});
