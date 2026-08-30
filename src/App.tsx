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
      <Toaster />
    </>
  );
}

export default App;
