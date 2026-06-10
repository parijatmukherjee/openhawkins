import { useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "./ui/GlassPanel";
import { NeonButton } from "./ui/NeonButton";

interface Settings {
  theme: "dark" | "light";
  reducedMotion: boolean;
  shortcut: string;
  autoStart: boolean;
}

const defaultSettings: Settings = {
  theme: "dark",
  reducedMotion: false,
  shortcut: "CommandOrControl+Shift+J",
  autoStart: true,
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: isOpen ? 1 : 0 }}
      transition={{ duration: 0.2 }}
      style={{ pointerEvents: isOpen ? "auto" : "none" }}
    >
      <motion.div
        className="w-full max-w-md mx-4"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: isOpen ? 1 : 0.95, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-medium">Settings</h2>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-neon-cyan transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <span className="text-sm">Theme</span>
              <div className="flex gap-2">
                {(["dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => updateSetting("theme", t)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      settings.theme === t
                        ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30"
                        : "bg-white/5 text-text-secondary border border-white/10 hover:border-neon-cyan/20"
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Reduced Motion */}
            <div className="flex items-center justify-between">
              <span className="text-sm">Reduced Motion</span>
              <button
                onClick={() => updateSetting("reducedMotion", !settings.reducedMotion)}
                className={`w-10 h-6 rounded-full p-1 transition-colors ${
                  settings.reducedMotion ? "bg-neon-cyan/30" : "bg-white/10"
                }`}
              >
                <motion.div
                  className="w-4 h-4 rounded-full bg-white"
                  animate={{ x: settings.reducedMotion ? 16 : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            {/* Global Shortcut */}
            <div className="flex items-center justify-between">
              <span className="text-sm">Global Shortcut</span>
              <span className="text-xs font-mono text-neon-cyan bg-neon-cyan/10 px-2 py-1 rounded">
                {settings.shortcut}
              </span>
            </div>

            {/* Auto Start */}
            <div className="flex items-center justify-between">
              <span className="text-sm">Auto-start on Login</span>
              <button
                onClick={() => updateSetting("autoStart", !settings.autoStart)}
                className={`w-10 h-6 rounded-full p-1 transition-colors ${
                  settings.autoStart ? "bg-neon-cyan/30" : "bg-white/10"
                }`}
              >
                <motion.div
                  className="w-4 h-4 rounded-full bg-white"
                  animate={{ x: settings.autoStart ? 16 : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              </button>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <NeonButton onClick={onClose}>Done</NeonButton>
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}
