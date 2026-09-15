import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase account + cloud sync. Credentials come from .env (Vite bakes them
// in at build time — rotate by replacing the values and rebuilding). The app
// runs fully offline/anonymous when they are absent: every caller gates on
// isSupabaseConfigured() and getSupabase() throws otherwise.

function env(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  try {
    return (import.meta.env?.[name] as string | undefined)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function isSupabaseConfigured(): boolean {
  return env("VITE_SUPABASE_URL") !== "" && env("VITE_SUPABASE_ANON_KEY") !== "";
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
  }
  if (!client) {
    client = createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_ANON_KEY"), {
      auth: {
        // PKCE (not the library's implicit default): the provider returns a
        // `?code=` query the loopback listener can see. Implicit flow hides
        // tokens in the URL fragment, which browsers never send to a server —
        // the callback would arrive empty ("Missing sign-in parameters").
        flowType: "pkce",
      },
    });
  }
  return client;
}

/** Forget the client (used on sign-out so no session lingers in memory). */
export function resetSupabaseClient(): void {
  client = null;
}
