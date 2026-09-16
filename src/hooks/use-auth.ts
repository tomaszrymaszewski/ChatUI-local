import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSupabase, isSupabaseConfigured, resetSupabaseClient } from "@/lib/supabase";
import { clearBigStores } from "@/lib/idb-store";
import { clearAttachmentStore } from "@/lib/attachment-store";
import { OAUTH_REDIRECT_TO, parseOAuthCallback } from "@/lib/oauth-callback";
import { isTauri } from "@/lib/platform";

export interface AuthState {
  /** Null while loading or when Supabase is not configured / signed out. */
  user: User | null;
  loading: boolean;
  configured: boolean;
}

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Wrong email or password. Try again or create an account.";
  }
  if (/user already registered/i.test(message)) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (/password should be at least/i.test(message)) {
    return message;
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Couldn't reach the account server. Check your connection and try again.";
  }
  return message;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    configured: isSupabaseConfigured(),
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState({ user: null, loading: false, configured: false });
      return;
    }
    let alive = true;
    const client = getSupabase();
    void client.auth.getSession().then(({ data }) => {
      if (alive) setState({ user: data.session?.user ?? null, loading: false, configured: true });
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ user: session?.user ?? null, loading: false, configured: true });
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const { error } = await getSupabase().auth.signUp({
      email,
      password,
      ...(name ? { options: { data: { full_name: name } } } : {}),
    });
    if (error) throw new Error(friendlyError(error.message));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyError(error.message));
  }, []);

  // OAuth (Google/GitHub) opens the provider in the system browser and
  // Supabase redirects back to a one-shot loopback listener in the Rust shell
  // (allow-list OAUTH_REDIRECT_TO in the Supabase dashboard's Redirect URLs).
  // Works identically in dev and packaged builds — no OS URL-scheme
  // registration needed. Outside Tauri (browser preview) there is no shell
  // to catch the redirect, so the WebView navigates to the provider instead
  // and supabase-js picks the session out of the returning URL fragment.
  const signInWithProvider = useCallback(async (provider: "google" | "github") => {
    if (!isTauri) {
      const allowed = ["http://localhost:5173", "tauri://localhost"];
      const origin = window.location.origin;
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider,
        options: allowed.includes(origin) ? { redirectTo: origin } : undefined,
      });
      if (error) throw new Error(friendlyError(error.message));
      return;
    }
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: OAUTH_REDIRECT_TO, skipBrowserRedirect: true },
    });
    if (error) throw new Error(friendlyError(error.message));
    if (!data?.url) throw new Error("Couldn't start the sign-in. Try again.");
    await openUrl(data.url);
    // Blocks until the browser lands on the loopback callback (the shell
    // times out after 10 idle minutes). The PKCE verifier lives in this
    // webview's storage, so the exchange happens here, not in Rust.
    const target = await invoke<string>("wait_for_account_oauth_callback");
    const parsed = parseOAuthCallback(target);
    if (!parsed) throw new Error("Sign-in failed. Try again.");
    if (!("code" in parsed)) {
      throw new Error(parsed.description || "Sign-in was cancelled. Try again.");
    }
    const { error: exchangeError } = await getSupabase().auth.exchangeCodeForSession(parsed.code);
    if (exchangeError) throw new Error(friendlyError(exchangeError.message));
  }, []);

  const updateProfile = useCallback(async (patch: { name?: string; avatarUrl?: string | null }) => {
    const client = getSupabase();
    const { data: { session } } = await client.auth.getSession();
    const current = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = { ...current };
    if (patch.name !== undefined) {
      data.full_name = patch.name;
      data.name = patch.name;
    }
    if (patch.avatarUrl !== undefined) {
      if (patch.avatarUrl) {
        data.avatar_url = patch.avatarUrl;
        data.picture = patch.avatarUrl;
      } else {
        delete data.avatar_url;
        delete data.picture;
      }
    }
    const { data: updated, error } = await client.auth.updateUser({ data });
    if (error) throw new Error(friendlyError(error.message));
    setState((s) => (updated.user ? { ...s, user: updated.user } : s));
  }, []);

  const uploadAvatar = useCallback(async (file: File): Promise<string> => {
    const client = getSupabase();
    const { data: { session } } = await client.auth.getSession();
    const userId = session?.user.id;
    if (!userId) throw new Error("Not signed in");
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${userId}/avatar.${ext}`;
    const { error } = await client.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) throw new Error(friendlyError(error.message));
    const { data } = client.storage.from("avatars").getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    await updateProfile({ avatarUrl: url });
    return url;
  }, [updateProfile]);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) throw new Error(friendlyError(error.message));
  }, []);

  /**
   * Delete the account's cloud data and all local data, then sign out.
   * Supabase has no client-side "delete my auth user" call, so the auth
   * record itself is left for the project's own cleanup — every byte the app
   * owns (the user_data rows + every chatui* key on this device) is removed.
   */
  const deleteAccount = useCallback(async () => {
    const client = getSupabase();
    try {
      await client.from("user_data").delete().neq("key", "");
    } catch {
      // Offline or RLS failure — local wipe below still runs.
    }
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && /^chatui/.test(key)) doomed.push(key);
      }
      for (const key of doomed) localStorage.removeItem(key);
      // Big keys + attachment blobs live outside localStorage.
      await clearBigStores();
      await clearAttachmentStore();
    } catch {
      // Storage unreadable — nothing more we can do locally.
    }
    try {
      window.dispatchEvent(new Event("chatui:sessions-changed"));
      window.dispatchEvent(new Event("chatui:messages-changed"));
      window.dispatchEvent(new Event("chatui:providers-changed"));
      window.dispatchEvent(new Event("chatui:settings-changed"));
      window.dispatchEvent(new Event("chatui:agents-changed"));
      window.dispatchEvent(new Event("chatui:projects-changed"));
    } catch {
      // Headless/test runtimes without window.
    }
    try {
      await client.auth.signOut();
    } catch {
      // offline — local state below still clears
    } finally {
      resetSupabaseClient();
      setState((s) => ({ ...s, user: null }));
    }
  }, []);

  const signOut = useCallback(async () => {
    // Sign out is local-first: even if the server call fails (offline), the
    // local session is dropped so the app never looks half-logged-in.
    try {
      await getSupabase().auth.signOut();
    } catch {
      // offline — local state below still clears
    } finally {
      resetSupabaseClient();
      setState((s) => ({ ...s, user: null }));
    }
  }, []);

  return { ...state, signUp, signIn, signOut, signInWithProvider, updateProfile, uploadAvatar, updatePassword, deleteAccount };
}
