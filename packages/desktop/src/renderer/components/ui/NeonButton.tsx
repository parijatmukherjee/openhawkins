import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface NeonButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export function NeonButton({
  children,
  onClick,
  variant = "primary",
  disabled = false,
}: NeonButtonProps) {
  return (
    <motion.button
      className={`neon-button ${variant === "secondary" ? "bg-opacity-5" : ""}`}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.button>
  );
}
