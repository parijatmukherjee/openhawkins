import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { StatusDot } from "../ui/StatusDot";

interface Task {
  id: string;
  agentId: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  duration?: string;
}

const mockTasks: Task[] = [
  { id: "1", agentId: "weather", description: "Fetching weather data", status: "running", progress: 65, duration: "1.2s" },
  { id: "2", agentId: "calendar", description: "Loading calendar events", status: "completed", duration: "0.8s" },
  { id: "3", agentId: "research", description: "Web search: AI trends 2025", status: "pending" },
  { id: "4", agentId: "system", description: "Opening Calendar app", status: "completed", duration: "0.3s" },
];

const statusLabels = {
  pending: "Pending",
  running: "Running",
  completed: "Done",
  failed: "Failed",
};

export function TaskBoard() {
  return (
    <GlassPanel className="p-6 h-full">
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
        <StatusDot status="success" pulse />
        Active Tasks
      </h2>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        <AnimatePresence>
          {mockTasks.map((task, index) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{
                duration: 0.2,
                delay: index * 0.08,
                ease: [0.23, 1, 0.32, 1],
              }}
              className="p-3 rounded-lg bg-white/5 border border-white/5 hover:border-neon-cyan/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusDot
                    status={
                      task.status === "completed"
                        ? "success"
                        : task.status === "failed"
                          ? "error"
                          : task.status === "running"
                            ? "success"
                            : "idle"
                    }
                    pulse={task.status === "running"}
                  />
                  <span className="text-sm font-medium">{task.agentId}</span>
                </div>
                <span
                  className={`text-xs ${
                    task.status === "completed"
                      ? "text-status-success"
                      : task.status === "failed"
                        ? "text-status-error"
                        : task.status === "running"
                          ? "text-status-success"
                          : "text-status-idle"
                  }`}
                >
                  {statusLabels[task.status]}
                </span>
              </div>

              <p className="text-sm text-text-secondary mb-2">{task.description}</p>

              {task.progress !== undefined && (
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-neon-teal to-neon-cyan"
                    initial={{ width: 0 }}
                    animate={{ width: `${task.progress}%` }}
                    transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                  />
                </div>
              )}

              {task.duration && (
                <span className="text-xs text-text-secondary mt-1 block">{task.duration}</span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </GlassPanel>
  );
}
