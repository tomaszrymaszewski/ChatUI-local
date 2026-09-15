import { useEffect, useState } from "react";
import {
  Bot,
  Database,
  Eye,
  EyeOff,
  GalleryVerticalEnd,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GithubLogo, GoogleLogo } from "@/components/brand-logos";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { avatarColorStyle, getAccountProfile, profileInitials } from "@/lib/account-profile";
import { getSupabase } from "@/lib/supabase";

/** Flat vector scene: an AI chat exchange with model chips. */
function ChatArt() {
  return (
    <svg
      viewBox="0 0 320 220"
      className="h-auto w-full max-w-sm"
      role="img"
      aria-label="AI chat conversation illustration"
    >
      <ellipse cx="160" cy="110" rx="140" ry="90" fill="#38bdf8" opacity="0.08" />
      <rect x="36" y="36" width="188" height="72" rx="18" fill="#e0f2fe" />
      <rect x="56" y="58" width="118" height="10" rx="5" fill="#0369a1" opacity="0.55" />
      <rect x="56" y="76" width="86" height="10" rx="5" fill="#0369a1" opacity="0.3" />
      <path
        d="M246 40 l2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5 Z"
        fill="#fbbf24"
      />
      <path
        d="M272 66 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z"
        fill="#fbbf24"
        opacity="0.7"
      />
      <rect x="96" y="118" width="188" height="54" rx="18" fill="#3f3f46" />
      <rect x="116" y="136" width="128" height="10" rx="5" fill="#fafafa" opacity="0.7" />
      <rect x="160" y="154" width="84" height="10" rx="5" fill="#fafafa" opacity="0.35" />
      <rect x="36" y="184" width="88" height="24" rx="12" fill="none" stroke="#52525b" strokeWidth="1.5" />
      <circle cx="53" cy="196" r="5" fill="#34d399" />
      <rect x="63" y="192" width="50" height="8" rx="4" fill="#71717a" />
      <rect x="132" y="184" width="88" height="24" rx="12" fill="none" stroke="#52525b" strokeWidth="1.5" />
      <circle cx="149" cy="196" r="5" fill="#a78bfa" />
      <rect x="159" y="192" width="50" height="8" rx="4" fill="#71717a" />
      <rect x="228" y="184" width="56" height="24" rx="12" fill="none" stroke="#52525b" strokeWidth="1.5" />
      <path d="M256 190 v12 M250 196 h12" stroke="#71717a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Flat vector scene: an agent working through a task list. */
function AgentArt() {
  return (
    <svg
      viewBox="0 0 320 220"
      className="h-auto w-full max-w-sm"
      role="img"
      aria-label="Agent completing tasks illustration"
    >
      <ellipse cx="160" cy="110" rx="140" ry="90" fill="#a78bfa" opacity="0.08" />
      <rect x="44" y="36" width="232" height="148" rx="14" fill="#27272a" stroke="#3f3f46" strokeWidth="1.5" />
      <circle cx="62" cy="54" r="4" fill="#f87171" />
      <circle cx="74" cy="54" r="4" fill="#fbbf24" />
      <circle cx="86" cy="54" r="4" fill="#34d399" />
      <rect x="104" y="50" width="88" height="8" rx="4" fill="#52525b" />
      <line x1="44" y1="66" x2="276" y2="66" stroke="#3f3f46" strokeWidth="1.5" />
      <circle cx="66" cy="90" r="8" fill="#34d399" />
      <path d="M62 90 l3 3 6 -6" stroke="#09090b" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="82" y="86" width="150" height="9" rx="4.5" fill="#71717a" opacity="0.5" />
      <circle cx="66" cy="114" r="8" fill="#34d399" />
      <path d="M62 114 l3 3 6 -6" stroke="#09090b" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="82" y="110" width="110" height="9" rx="4.5" fill="#71717a" opacity="0.5" />
      <circle cx="66" cy="138" r="8" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="36 14" strokeLinecap="round" />
      <rect x="82" y="134" width="130" height="9" rx="4.5" fill="#71717a" />
      <rect x="82" y="148" width="80" height="8" rx="4" fill="#71717a" opacity="0.4" />
      <rect x="198" y="148" width="56" height="22" rx="11" fill="#38bdf8" />
      <path d="M220 154 l9 5.5 -9 5.5 Z" fill="#09090b" />
      <line x1="252" y1="150" x2="252" y2="144" stroke="#a78bfa" strokeWidth="2.5" />
      <circle cx="252" cy="141" r="2.5" fill="#a78bfa" />
      <circle cx="252" cy="172" r="24" fill="#a78bfa" />
      <circle cx="244" cy="170" r="3" fill="#09090b" />
      <circle cx="260" cy="170" r="3" fill="#09090b" />
      <path d="M244 180 q8 6 16 0" stroke="#09090b" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Flat vector scene: laptop + phone syncing through the cloud. */
function SyncArt() {
  return (
    <svg
      viewBox="0 0 320 220"
      className="h-auto w-full max-w-sm"
      role="img"
      aria-label="Devices syncing illustration"
    >
      <ellipse cx="160" cy="120" rx="140" ry="85" fill="#34d399" opacity="0.08" />
      <circle cx="118" cy="46" r="13" fill="#e4e4e7" />
      <circle cx="138" cy="38" r="17" fill="#e4e4e7" />
      <circle cx="158" cy="46" r="12" fill="#e4e4e7" />
      <rect x="105" y="46" width="66" height="13" rx="6.5" fill="#e4e4e7" />
      <rect x="52" y="70" width="150" height="100" rx="10" fill="#27272a" stroke="#52525b" strokeWidth="1.5" />
      <rect x="62" y="82" width="130" height="76" rx="6" fill="#18181b" />
      <rect x="72" y="94" width="80" height="9" rx="4.5" fill="#38bdf8" opacity="0.8" />
      <rect x="72" y="108" width="56" height="9" rx="4.5" fill="#38bdf8" opacity="0.4" />
      <rect x="100" y="122" width="82" height="9" rx="4.5" fill="#71717a" />
      <rect x="72" y="136" width="96" height="9" rx="4.5" fill="#38bdf8" opacity="0.55" />
      <rect x="40" y="170" width="174" height="10" rx="5" fill="#3f3f46" />
      <rect x="216" y="96" width="56" height="96" rx="10" fill="#27272a" stroke="#52525b" strokeWidth="1.5" />
      <rect x="222" y="106" width="44" height="66" rx="4" fill="#18181b" />
      <rect x="228" y="114" width="32" height="7" rx="3.5" fill="#34d399" opacity="0.8" />
      <rect x="228" y="125" width="24" height="7" rx="3.5" fill="#34d399" opacity="0.4" />
      <rect x="236" y="136" width="24" height="7" rx="3.5" fill="#71717a" />
      <circle cx="244" cy="183" r="3" fill="#52525b" />
      <circle cx="196" cy="72" r="10" fill="#34d399" />
      <path d="M191 72 l4 4 7 -7" stroke="#09090b" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="268" cy="98" r="10" fill="#34d399" />
      <path d="M263 98 l4 4 7 -7" stroke="#09090b" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SLIDES = [
  {
    icon: MessageCircle,
    title: "Chat with any model",
    description:
      "Bring your own keys and talk to frontier models or local ones — pick whatever fits the job.",
    short: "Frontier or local models, your keys",
    art: <ChatArt />,
  },
  {
    icon: Bot,
    title: "Agents that do the work",
    description:
      "Hand off research, coding, and busywork to agents with tools, skills, and memory.",
    short: "Tools, skills, and memory",
    art: <AgentArt />,
  },
  {
    icon: RefreshCw,
    title: "Pick up anywhere",
    description:
      "Chats, agents, and settings sync across your devices — with a copy that always stays on this Mac.",
    short: "Synced, plus a local copy",
    art: <SyncArt />,
  },
];

/**
 * Full-page sign in / sign up / signed-in state in the shadcn split-screen
 * login style: the form on one side, a rotating use-case showcase on the other.
 */
export function AccountView({ onDone, hideClose }: { onDone: () => void; hideClose?: boolean }) {
  const { user, loading, configured, signUp, signIn, signOut, signInWithProvider } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);

  const passwordMismatch =
    mode === "signup" && confirmPassword !== "" && confirmPassword !== password;

  const canSubmit =
    !busy &&
    email.trim() !== "" &&
    password !== "" &&
    (mode === "signin" ||
      (name.trim() !== "" && confirmPassword !== "" && !passwordMismatch));

  // Opens the provider in the system browser; the promise resolves once the
  // redirect comes back to the app and the session is established.
  const [oauthBusy, setOauthBusy] = useState<"google" | "github" | null>(null);
  const handleOAuth = async (provider: "google" | "github") => {
    setOauthBusy(provider);
    setError(null);
    setNotice(null);
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
    setNotice(null);
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password, name.trim());
        // When email confirmation is off the new session lands immediately and
        // the connected state takes over; otherwise the user signs in next.
        setMode("signin");
        setNotice("Account created — sign in to connect it on this device.");
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!hideClose && (
        <Button
          variant="outline"
          size="icon"
          onClick={onDone}
          aria-label="Close"
          className="fixed top-4 right-4 z-10 rounded-full bg-background/80 backdrop-blur"
        >
          <X />
        </Button>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-4">
        <div className="absolute top-1/2 left-[3%] hidden w-60 -translate-y-1/2 xl:block">
          <HoverArt
            icon={SLIDES[0].icon}
            title={SLIDES[0].title}
            description={SLIDES[0].description}
            art={SLIDES[0].art}
          />
        </div>
        <div className="absolute top-1/2 right-[3%] hidden w-60 -translate-y-1/2 flex-col gap-10 xl:flex">
          <HoverArt
            icon={SLIDES[1].icon}
            title={SLIDES[1].title}
            description={SLIDES[1].description}
            art={SLIDES[1].art}
          />
          <HoverArt
            icon={SLIDES[2].icon}
            title={SLIDES[2].title}
            description={SLIDES[2].description}
            art={SLIDES[2].art}
          />
        </div>
        <div className="relative z-10 flex max-h-full w-full max-w-sm flex-col gap-4 overflow-y-auto py-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !configured ? (
            <>
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <GalleryVerticalEnd className="size-5" />
                </span>
                <h1 className="text-2xl font-bold">Connect your account</h1>
              </div>
              <p className="rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
                Accounts aren&apos;t configured in this build (missing Supabase
                credentials). The app works fully offline. Everything stays on
                this device.
              </p>
              <Button variant="outline" onClick={onDone}>
                Continue offline
              </Button>
            </>
          ) : user ? (
            <AccountSettings
              onDone={onDone}
              signingOut={signingOut}
              onSignOut={() => void handleSignOut()}
            />
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 text-center mb-4">
                <h1 className="text-2xl font-bold">Connect your account</h1>
              </div>

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
                      setConfirmPassword("");
                      setError(null);
                      setNotice(null);
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

              <div className="grid gap-4">
                {mode === "signup" && (
                  <div className="grid gap-2">
                    <Label htmlFor="account-name">Name</Label>
                    <Input
                      id="account-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmit) void handleSubmit();
                      }}
                    />
                  </div>
                )}
                <div className="grid gap-2">
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
                <div className="grid gap-2">
                  <Label htmlFor="account-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="account-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      placeholder={
                        mode === "signin"
                          ? "Your password"
                          : "At least 6 characters"
                      }
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
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                {mode === "signup" && (
                  <div className="grid gap-2">
                    <Label htmlFor="account-confirm-password">
                      Repeat password
                    </Label>
                    <Input
                      id="account-confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmit) void handleSubmit();
                      }}
                    />
                  </div>
                )}
              </div>

              {notice && (
                <p className="-mt-3 text-xs leading-relaxed text-muted-foreground">
                  {notice}
                </p>
              )}
              {passwordMismatch ? (
                <p className="-mt-3 text-xs leading-relaxed text-destructive">
                  Passwords don&apos;t match.
                </p>
              ) : (
                error && (
                  <p className="-mt-3 text-xs leading-relaxed text-destructive">
                    {error}
                  </p>
                )
              )}

              <Button
                className="-mt-3 w-full"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>

              <p className="-mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                By connecting an account you agree to our <a>Terms & Policy</a>.
                A backup always stays on this device either way.
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/** Showcase graphic beside the sign-in form — hover or focus reveals its description. */
function HoverArt({
  icon: Icon,
  title,
  description,
  art,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  art: React.ReactNode;
}) {
  return (
    <div
      tabIndex={0}
      className="group relative rounded-2xl outline-none"
    >
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4" />
        </span>
        {art}
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <div className="pointer-events-auto flex max-w-60 flex-col gap-1 rounded-xl border bg-background/95 p-4 text-center shadow-lg backdrop-blur">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        </div>
      </div>
    </div>
  );
}

export type AccountTab = "profile" | "security" | "data";

export const ACCOUNT_TABS: Array<{ id: AccountTab; label: string; icon: typeof UserRound }> = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "security", label: "Password", icon: ShieldCheck },
  { id: "data", label: "Stored data", icon: Database },
];

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Account settings for the signed-in user: profile (name + avatar), password,
 * a view of what the account stores in the cloud database, and account
 * removal. Rendered inside AccountView's form column, so it shares the
 * split-screen showcase while signed out views keep the sign-in form.
 */
export function AccountSettings({
  onDone,
  signingOut,
  onSignOut,
  activeTab,
  onTabChange,
}: {
  onDone: () => void;
  signingOut: boolean;
  onSignOut: () => void;
  /** Controlled tab for the settings-style account view (sidebar owns the nav). */
  activeTab?: AccountTab;
  onTabChange?: (tab: AccountTab) => void;
}) {
  const { user, deleteAccount } = useAuth();
  const profile = getAccountProfile(user);
  const [internalTab, setInternalTab] = useState<AccountTab>("profile");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Controlled (embedded in the account view — the app sidebar owns the tabs)
  // or standalone (the connect modal owns its own nav).
  const embedded = activeTab !== undefined;
  const tab = activeTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  if (!user || !profile) return null;

  const tabContent = (
    <>
      {tab === "profile" && <ProfileTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "data" && <DataTab />}
    </>
  );

  const deleteDialog = (
    <DeleteAccountDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      email={profile.email}
      onDelete={async () => {
        await deleteAccount();
        toast.success("Account data deleted");
        onDone();
        setTimeout(() => window.location.reload(), 500);
      }}
    />
  );

  if (embedded) {
    return (
      <div className="flex w-full flex-col gap-6">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.name} />}
            <AvatarFallback style={avatarColorStyle(profile.email)}>
              {profileInitials(profile.name, profile.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold">{profile.name}</span>
            <span className="truncate text-sm text-muted-foreground">{profile.email}</span>
          </div>
        </div>

        {tabContent}

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSignOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
            Sign out
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive">
            <Trash2 />
            Delete account…
          </Button>
        </div>

        {deleteDialog}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 py-6">
      <div className="flex items-center gap-3">
        <Avatar size="lg">
          {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.name} />}
          <AvatarFallback style={avatarColorStyle(profile.email)}>
            {profileInitials(profile.name, profile.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{profile.name}</span>
          <span className="truncate text-sm text-muted-foreground">{profile.email}</span>
        </div>
      </div>

      <div className="flex gap-4">
        <nav className="flex w-32 shrink-0 flex-col gap-1" aria-label="Account settings">
          {ACCOUNT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                tab === t.id
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
          <Separator className="my-2" />
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        </nav>

        <div className="min-w-0 flex-1">
          {tabContent}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>

      {deleteDialog}
    </div>
  );
}

function ProfileTab() {
  const { user, updateProfile } = useAuth();
  const profile = getAccountProfile(user);
  const [name, setName] = useState(profile?.name ?? "");
  const [saving, setSaving] = useState(false);

  if (!user || !profile) return null;
  const canSave = !saving && name.trim() !== "" && name.trim() !== profile.name;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">

      <div className="grid gap-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) void handleSave();
          }}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" type="email" value={profile.email} disabled />
      </div>

      <div>
        <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
          {saving && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function SecurityTab() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm !== "" && confirm !== password;
  const canSave = !saving && password.length >= 6 && !mismatch && confirm !== "";

  const handleSave = async () => {
    setSaving(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      toast.success("Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="security-password">New password</Label>
        <div className="relative">
          <Input
            id="security-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) void handleSave();
            }}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="security-confirm">Repeat new password</Label>
        <Input
          id="security-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) void handleSave();
          }}
        />
      </div>
      {mismatch && (
        <p className="text-xs leading-relaxed text-destructive">Passwords don&apos;t match.</p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Google/GitHub sign-ins don&apos;t use a password — set one here to also sign in with email.
      </p>
      <div>
        <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
          {saving && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </div>
    </div>
  );
}

interface StoredRow {
  key: string;
  bytes: number;
  updatedAt: string;
  origin: "This device" | "Cloud";
}

function DataTab() {
  const [rows, setRows] = useState<StoredRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const seen = new Map<string, StoredRow>();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !/^chatui/.test(key) || key === "chatui:sync:meta") continue;
        const value = localStorage.getItem(key) ?? "";
        seen.set(key, {
          key,
          bytes: value.length,
          updatedAt: "",
          origin: "This device",
        });
      }
    } catch {
      // Storage unreadable — fall through to the cloud rows.
    }
    try {
      const { data, error: fetchError } = await getSupabase()
        .from("user_data")
        .select("key,value,updated_at")
        .eq("deleted", false);
      if (fetchError) throw new Error(fetchError.message);
      for (const row of (data ?? []) as Array<{ key: string; value: string; updated_at: string }>) {
        const local = seen.get(row.key);
        seen.set(row.key, {
          key: row.key,
          bytes: Math.max(local?.bytes ?? 0, row.value?.length ?? 0),
          updatedAt: row.updated_at,
          origin: local ? "This device" : "Cloud",
        });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the stored data");
    }
    setRows([...seen.values()].sort((a, b) => b.bytes - a.bytes));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = rows?.reduce((n, r) => n + r.bytes, 0) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows === null
            ? "Loading…"
            : `${rows.length} synced ${rows.length === 1 ? "key" : "keys"} · ${formatBytes(total)}`}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border p-2">
        {rows === null ? (
          <span className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </span>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            Nothing stored yet — chats, providers, and settings appear here once they sync.
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{r.key}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {r.origin}
                  {r.updatedAt ? ` · synced ${new Date(r.updatedAt).toLocaleString()}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(r.bytes)}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each row is one localStorage key mirrored verbatim to your account&apos;s database. A backup
        copy always stays on this device.
      </p>
    </div>
  );
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirm("");
      setBusy(false);
    }
  }, [open ]);

  const canDelete = !busy && confirm.trim().toLowerCase() === "delete";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" />
            Delete account and all data?
          </DialogTitle>
          <DialogDescription>
            This removes <span className="font-medium">{email}</span>&apos;s synced data from the
            database and erases everything stored on this device (chats, agents, projects,
            providers, settings). This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
          <Input
            id="delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canDelete) {
                setBusy(true);
                void onDelete().finally(() => setBusy(false));
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => {
              setBusy(true);
              void onDelete().finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            Delete everything
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
