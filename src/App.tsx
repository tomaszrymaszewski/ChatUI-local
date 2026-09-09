import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ChatView } from "@/components/ChatView";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { isOnboardingDone } from "@/lib/onboarding";
import { loadUserSettings } from "@/hooks/use-user-settings";
import { headroomStart } from "@/lib/headroom-client";

function App() {
  const [onboarded, setOnboarded] = useState(() => isOnboardingDone());

  // If the user enabled context compression, make sure the local Headroom
  // proxy is running. Non-blocking: a missing proxy just leaves compression
  // inert (the client circuit-breaker passes everything through).
  useEffect(() => {
    if (loadUserSettings().contextCompression) {
      void headroomStart();
    }
  }, []);

  return (
    <>
      {onboarded ? (
        <ChatView />
      ) : (
        <OnboardingWizard onFinish={() => setOnboarded(true)} />
      )}
      {/* Top-right so error/event notifications never cover the composer
          buttons at the bottom; offset clears the 40px title bar. */}
      <Toaster position="top-right" offset={48} />
    </>
  );
}

export default App;
