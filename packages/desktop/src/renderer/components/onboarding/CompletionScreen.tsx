import { motion } from "framer-motion";
import { NeonButton } from "../ui/NeonButton";

interface CompletionScreenProps {
  onComplete: () => void;
}

export function CompletionScreen({ onComplete }: CompletionScreenProps) {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-bg-deep">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="text-center"
      >
        <div className="relative mb-8">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-neon-cyan/20"
              style={{
                width: `${i * 80}px`,
                height: `${i * 80}px`,
                top: `${-i * 40 + 40}px`,
                left: `${-i * 40 + 40}px`,
              }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
              transition={{
                duration: 2,
                delay: i * 0.3,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}

          <motion.div
            className="w-20 h-20 rounded-full bg-neon-cyan/20 flex items-center justify-center"
            style={{ boxShadow: "var(--glow-cyan-strong)" }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
          >
            <motion.svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00d4ff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              <path d="M20 6L9 17l-5-5" />
            </motion.svg>
          </motion.div>
        </div>

        <motion.h2
          className="text-4xl font-light tracking-tight text-neon-cyan mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          Ready
        </motion.h2>

        <motion.p
          className="text-text-secondary mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Jarvis is initialized and ready to assist you.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
        >
          <NeonButton onClick={onComplete}>Launch Dashboard</NeonButton>
        </motion.div>
      </motion.div>
    </div>
  );
}
