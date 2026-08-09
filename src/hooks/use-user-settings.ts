import { useEffect, useState, useCallback } from "react";
import type { UserSettings } from "@/types";

const STORAGE_KEY = "chatui:settings";

const DEFAULT_SETTINGS: UserSettings = {
  defaultModel: null,
  sendOnEnter: true,
  showTimestamps: true,
  soundEffects: false,
  temporaryByDefault: false,
  autoMemory: true,
  fullName: "",
  nickname: "",
  instructions: "",
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
};

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const data = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...data };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: UserSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSettings(loadSettings());
    setLoading(false);
  }, []);

  const updateSettings = useCallback(
    async (updates: Partial<UserSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        saveSettings(next);
        return next;
      });
    },
    [],
  );

  return { settings, loading, updateSettings };
}
