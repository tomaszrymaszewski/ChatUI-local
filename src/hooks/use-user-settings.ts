import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { UserSettings } from "@/types";

const DEFAULT_SETTINGS: UserSettings = {
  defaultModel: null,
  sendOnEnter: true,
  showTimestamps: true,
  soundEffects: false,
  temporaryByDefault: false,
};

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from("user_settings")
      .select("default_model, send_on_enter, show_timestamps, sound_effects, temporary_by_default")
      .maybeSingle();

    if (error) {
      console.error("Error fetching settings:", error);
      setLoading(false);
      return;
    }

    if (data) {
      setSettings({
        defaultModel: data.default_model,
        sendOnEnter: data.send_on_enter,
        showTimestamps: data.show_timestamps,
        soundEffects: data.sound_effects,
        temporaryByDefault: data.temporary_by_default,
      });
    }
    setLoading(false);
  }, []);

  const updateSettings = useCallback(
    async (updates: Partial<UserSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);

      const { error } = await supabase
        .from("user_settings")
        .upsert({
          default_model: newSettings.defaultModel,
          send_on_enter: newSettings.sendOnEnter,
          show_timestamps: newSettings.showTimestamps,
          sound_effects: newSettings.soundEffects,
          temporary_by_default: newSettings.temporaryByDefault,
        });

      if (error) {
        console.error("Error updating settings:", error);
        setSettings(settings);
      }
    },
    [settings]
  );

  return { settings, loading, updateSettings };
}
