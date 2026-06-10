import { motion } from "framer-motion";
import { useAudioAnalysis } from "../../hooks/useAudioAnalysis";

export function VoiceWaveform() {
  const { amplitude, isSpeaking } = useAudioAnalysis();

  const rings = [0.3, 0.5, 0.7, 0.85, 1.0];

  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {rings.map((scale, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border-2 border-neon-cyan/20"
          style={{
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
          }}
          animate={{
            scale: isSpeaking ? 1 + amplitude * 0.15 : 1,
            opacity: isSpeaking ? 0.3 + amplitude * 0.5 : 0.15,
            borderColor: isSpeaking
              ? `rgba(0, 212, 255, ${0.2 + amplitude * 0.6})`
              : "rgba(0, 212, 255, 0.1)",
          }}
          transition={{
            duration: 0.15,
            ease: [0.23, 1, 0.32, 1],
            delay: i * 0.02,
          }}
        />
      ))}

      {/* Center glow */}
      <motion.div
        className="absolute w-16 h-16 rounded-full bg-neon-cyan/20"
        style={{ boxShadow: "var(--glow-cyan-strong)" }}
        animate={{
          scale: isSpeaking ? 1 + amplitude * 0.3 : 1,
          opacity: isSpeaking ? 0.5 + amplitude * 0.4 : 0.3,
        }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      />

      {/* Central text */}
      <motion.div
        className="relative z-10 text-center"
        animate={{ opacity: isSpeaking ? 1 : 0.7 }}
      >
        <span className="text-4xl font-light tracking-tighter text-neon-cyan">
          JARVIS
        </span>
      </motion.div>
    </div>
  );
}
