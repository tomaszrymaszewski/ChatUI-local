import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, Check, RefreshCw, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  relaunchApp,
  loadUpdateSettings,
  saveUpdateSettings,
  isUpdaterAvailable,
  type UpdateInfo,
} from "@/lib/updater";

type CheckState = "idle" | "checking" | "up-to-date" | "available" | "error";

export function UpdatesPanel() {
  const [settings, setSettings] = useState(loadUpdateSettings);
  const [currentVersion, setCurrentVersion] = useState<string>("—");
  const [state, setState] = useState<CheckState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [installed, setInstalled] = useState(false);

  const persistSettings = useCallback((next: typeof settings) => {
    setSettings(next);
    saveUpdateSettings(next);
  }, []);

  const doCheck = useCallback(async () => {
    setState("checking");
    setErrorMsg("");
    setUpdateInfo(null);
    try {
      const result = await checkForUpdate();
      setCurrentVersion(result.currentVersion);
      const next = { ...settings, lastChecked: new Date().toISOString() };
      persistSettings(next);
      if (result.available && result.info) {
        if (settings.skippedVersion === result.info.version) {
          setState("up-to-date");
        } else {
          setUpdateInfo(result.info);
          setState("available");
        }
      } else {
        setState("up-to-date");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not check for updates.");
      setState("error");
    }
  }, [settings, persistSettings]);

  useEffect(() => {
    if (isUpdaterAvailable()) {
      void doCheck();
    }
  }, []);

  const handleDownloadInstall = async () => {
    setDownloadProgress(0);
    try {
      await downloadAndInstallUpdate((event) => {
        if (event.event === "Started") {
          setDownloadProgress(0);
        } else if (event.event === "Progress") {
          const pct =
            event.contentLength && event.contentLength > 0
              ? (event.downloaded / event.contentLength) * 100
              : null;
          setDownloadProgress(pct);
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
          setInstalled(true);
        }
      });
      setInstalled(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Download failed.");
      setState("error");
      setDownloadProgress(null);
    }
  };

  const skipVersion = () => {
    if (!updateInfo) return;
    persistSettings({ ...settings, skippedVersion: updateInfo.version });
    setState("up-to-date");
    setUpdateInfo(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Updates</h2>
        <Separator />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownToLine className="size-5" />
              Current Version
            </CardTitle>
            <CardDescription>
              {isUpdaterAvailable()
                ? `You're running version ${currentVersion}.`
                : "Update checking is only available in the installed app."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <Label>Check for updates on launch</Label>
                <span className="text-xs text-muted-foreground">
                  Silently pings the web once when the app starts.
                </span>
              </div>
              <Switch
                checked={settings.autoCheck}
                onCheckedChange={(checked) =>
                  persistSettings({ ...settings, autoCheck: checked })
                }
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <Label>Last checked</Label>
                <span className="text-xs text-muted-foreground">
                  {settings.lastChecked
                    ? new Date(settings.lastChecked).toLocaleString()
                    : "Never"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void doCheck()}
                disabled={state === "checking" || !isUpdaterAvailable()}
              >
                <RefreshCw className={state === "checking" ? "animate-spin" : ""} />
                {state === "checking" ? "Checking…" : "Check now"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {state === "up-to-date" && (
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <Check className="size-5 text-green-500" />
              <span className="text-sm font-medium">
                You're up to date — version {currentVersion}.
              </span>
            </CardContent>
          </Card>
        )}

        {state === "available" && updateInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Update available — v{updateInfo.version}</CardTitle>
              <CardDescription>
                A new version is ready to download and install.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {updateInfo.body && (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                  {updateInfo.body}
                </div>
              )}
              {downloadProgress !== null && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {installed ? "Downloaded" : "Downloading…"}
                    </span>
                    {downloadProgress > 0 && (
                      <span>{Math.round(downloadProgress)}%</span>
                    )}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${downloadProgress > 0 ? Math.round(downloadProgress) : 5}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                {!installed && (
                  <Button
                    size="sm"
                    onClick={() => void handleDownloadInstall()}
                    disabled={downloadProgress !== null && downloadProgress < 100}
                  >
                    <ArrowDownToLine />
                    Download &amp; install
                  </Button>
                )}
                {installed && (
                  <Button size="sm" onClick={() => void relaunchApp()}>
                    <RotateCcw />
                    Restart to finish
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={skipVersion}>
                  Skip this version
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {state === "error" && (
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="size-5 text-orange-500" />
              <span className="text-sm text-muted-foreground">{errorMsg}</span>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
