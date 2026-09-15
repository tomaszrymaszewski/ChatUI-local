import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GithubLogo, GoogleLogo } from "@/components/brand-logos";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

/**
 * Sign in / sign up / signed-in state for the onboarding account step.
 * (The in-app account screen is the full-page AccountView in src/pages/account.tsx.)
 */
export function AccountPanel({ onDone }: { onDone: () => void }) {
  const { user, loading, configured, signUp, signIn, signOut, signInWithProvider } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!configured) {
    return (
      <p className="rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        Accounts aren't configured in this build (missing Supabase credentials).
        The app works fully offline — everything stays on this device.
      </p>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-primary" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Connected as {user.email}</span>
            <span className="text-xs text-muted-foreground">
              Your chats sync to your account and merge across devices. Signing out keeps
              everything on this device.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onDone}>Continue</Button>
          <Button
            variant="ghost"
            onClick={() => void signOut().then(onDone)}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const canSubmit = !busy && email.trim() !== "" && password !== "";

  // Opens the provider in the system browser; the promise resolves once the
  // redirect comes back to the app and the session is established.
  const handleOAuth = async (provider: "google" | "github") => {
    setOauthBusy(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      // The browser flow returns to the app (no page unload), so the
      // spinner must reset on success too — not just on failure.
      setOauthBusy(null);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={() => void handleOAuth("google")}
          disabled={oauthBusy !== null}
        >
          {oauthBusy === "google" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <GoogleLogo className="size-4" />
          )}
          Google
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleOAuth("github")}
          disabled={oauthBusy !== null}
        >
          {oauthBusy === "github" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <GithubLogo className="size-4" />
          )}
          GitHub
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background px-2 text-muted-foreground">
            Or continue with email
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              mode === m
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="account-email">Email</Label>
        <Input
          id="account-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) void handleSubmit();
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="account-password">Password</Label>
        <div className="relative">
          <Input
            id="account-password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signin" ? "Your password" : "At least 6 characters"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) void handleSubmit();
            }}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}

      <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
        {busy && <Loader2 className="animate-spin" />}
        {mode === "signin" ? "Sign in" : "Create account"}
      </Button>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {mode === "signin"
          ? "Your chats and settings download and merge with what's on this device."
          : "Your chats and settings upload to your new account as an off-device copy."}{" "}
        A backup always stays on this device either way.
      </p>
    </div>
  );
}
