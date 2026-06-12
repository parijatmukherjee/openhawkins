import { useState } from "react";
import { NexusProvider } from "./contexts/NexusContext";
import { createMockNexusBridge } from "./lib/mock-nexus-bridge";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { WindowControls } from "./components/WindowControls";
import { SettingsPanel } from "./components/SettingsPanel";

export function App() {
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const bridge = useState(() => createMockNexusBridge())[0];

  return (
    <NexusProvider value={bridge}>
      <div className="relative">
        <WindowControls onSettings={() => setShowSettings(true)} />
        <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
        {showOnboarding ? (
          <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
        ) : (
          <DashboardLayout />
        )}
      </div>
    </NexusProvider>
  );
}
