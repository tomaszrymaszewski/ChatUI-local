import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ChatView } from "@/components/ChatView";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { isOnboardingDone } from "@/lib/onboarding";

function App() {
  const [onboarded, setOnboarded] = useState(() => isOnboardingDone());

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
