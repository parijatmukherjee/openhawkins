import { motion } from "framer-motion";

export type Status = "success" | "warning" | "error" | "idle" | "active" | "busy" | "failed";

interface StatusDotProps {
  status: Status;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

const statusMap: Record<Status, string> = {
  success: "status-dot--success",
  active: "status-dot--success",
  warning: "status-dot--warning",
  busy: "status-dot--warning",
  error: "status-dot--error",
  failed: "status-dot--error",
  idle: "status-dot--idle",
};

export function StatusDot({ status, size = "md", pulse = false }: StatusDotProps) {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-2 h-2",
    lg: "w-3 h-3",
  };

  return (
    <motion.div
      data-testid="status-dot"
      className={`status-dot ${statusMap[status]} ${sizeClasses[size]}`}
      animate={pulse ? { scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] } : {}}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
