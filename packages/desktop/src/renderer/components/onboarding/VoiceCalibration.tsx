import { useState } from "react";
import { motion } from "framer-motion";
import { NeonButton } from "../ui/NeonButton";
import { GlassPanel } from "../ui/GlassPanel";
import { VoiceWaveform } from "../ui/VoiceWaveform";

interface VoiceCalibrationProps {
  onNext: () => void;
}

export function VoiceCalibration({ onNext }: VoiceCalibrationProps) {
  const [step, setStep] = useState<"idle" | "calibrating" | "done">("idle");
  const [confidence, setConfidence] = useState(0);

  const startCalibration = () => {
    setStep("calibrating");
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setStep("done");
      }
      setConfidence(progress);
    }, 200);
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-bg-deep px-6">
      <motion.div
        className="max-w-md w-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl font-light tracking-tight text-center mb-2">
          Voice Calibration
        </h2>
        <p className="text-text-secondary text-center mb-8">
          {step === "idle"
            ? "Calibrate your microphone for optimal voice recognition."
            : step === "calibrating"
              ? "Listening..."
              : "Calibration complete!"}
        </p>

        <div className="flex justify-center mb-8">
          <VoiceWaveform />
        </div>

        {step !== "idle" && (
          <GlassPanel className="p-4 mb-8">
            <div className="flex justify-between text-sm mb-2">
              <span>Confidence</span>
              <span className="text-neon-cyan">{confidence.toFixed(0)}%</span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-neon-teal to-neon-cyan"
                animate={{ width: `${confidence}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </GlassPanel>
        )}

        <div className="flex justify-center gap-4">
          {step === "idle" && (
            <NeonButton onClick={startCalibration}>Start Calibration</NeonButton>
          )}
          {step === "done" && <NeonButton onClick={onNext}>Continue</NeonButton>}
        </div>
      </motion.div>
    </div>
  );
}
