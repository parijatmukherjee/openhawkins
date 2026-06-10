import { useState } from "react";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { WindowControls } from "./components/WindowControls";
import { SettingsPanel } from "./components/SettingsPanel";

export function App() {
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="relative">
      <WindowControls onSettings={() => setShowSettings(true)} />
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      {showOnboarding ? (
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      ) : (
        <DashboardLayout />
      )}
    </div>
  );
}
