/**
 * OAuth callback parsing for the system-browser sign-in flow.
 *
 * In the Tauri app, Google/GitHub sign-in opens the provider in the system
 * browser and Supabase redirects back to a one-shot loopback listener in the
 * Rust shell (`wait_for_account_oauth_callback` in `src-tauri/src/lib.rs`),
 * which hands the request target (path + query) to the frontend. The target
 * carries a PKCE `code` that the app exchanges for a session — or `error`
 * params when the user cancels or something goes wrong.
 *
 * The redirect URL below must be allow-listed in the Supabase dashboard
 * (Authentication → URL Configuration → Redirect URLs), otherwise Supabase
 * refuses the redirect. Port and path must match ACCOUNT_OAUTH_CALLBACK_PORT
 * / ACCOUNT_OAUTH_CALLBACK_PATH in `src-tauri/src/lib.rs`.
 */

export const OAUTH_CALLBACK_PORT = 19877;
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_REDIRECT_TO = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;

export type OAuthCallback =
  | { code: string }
  | { error: string; description: string | null };

/**
 * Parse a callback target into an OAuth result. Accepts the full redirect
 * URL or just the request target the Rust listener returns. Returns null
 * when there are no OAuth params to interpret.
 */
export function parseOAuthCallback(rawUrl: string): OAuthCallback | null {
  let url: URL;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    return null;
  }
  const code = url.searchParams.get("code");
  if (code) return { code };
  const error = url.searchParams.get("error");
  if (error) {
    return { error, description: url.searchParams.get("error_description") };
  }
  return null;
}
