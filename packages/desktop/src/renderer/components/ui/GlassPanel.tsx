import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  glow?: "cyan" | "cyan-strong" | "none";
  onClick?: () => void;
}

export function GlassPanel({
  children,
  className = "",
  glow = "cyan",
  onClick,
}: GlassPanelProps) {
  const glowClass =
    glow === "cyan-strong"
      ? "shadow-[var(--panel-inner-glow),var(--glow-cyan-strong)]"
      : glow === "cyan"
        ? "shadow-[var(--panel-inner-glow),var(--glow-cyan)]"
        : "shadow-[var(--panel-inner-glow)]";

  return (
    <motion.div
      className={`glass-panel ${glowClass} ${className}`}
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}
