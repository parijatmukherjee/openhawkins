import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "./ui/GlassPanel";
import { StatusDot } from "./ui/StatusDot";

interface AgentDetail {
  id: string;
  name: string;
  role: string;
  status: "active" | "busy" | "failed" | "idle";
  description: string;
  capabilities: string[];
  lastActivity: string;
  tasksCompleted: number;
}

interface AgentDetailModalProps {
  agent: AgentDetail | null;
  onClose: () => void;
}

export function AgentDetailModal({ agent, onClose }: AgentDetailModalProps) {
  return (
    <AnimatePresence>
      {agent && (
        <motion.div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm mx-4"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <GlassPanel className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <StatusDot status={agent.status} size="lg" pulse={agent.status === "active"} />
                <div>
                  <h3 className="text-lg font-medium">{agent.name}</h3>
                  <p className="text-xs text-text-secondary">{agent.role}</p>
                </div>
              </div>

              <p className="text-sm text-text-secondary mb-4">{agent.description}</p>

              <div className="mb-4">
                <span className="text-xs font-medium text-text-secondary">Capabilities</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-xs bg-neon-cyan/10 text-neon-cyan px-2 py-1 rounded"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex justify-between text-xs text-text-secondary">
                <span>Last activity: {agent.lastActivity}</span>
                <span>{agent.tasksCompleted} tasks</span>
              </div>

              <button
                onClick={onClose}
                className="mt-4 w-full py-2 text-center text-sm text-text-secondary hover:text-neon-cyan transition-colors"
              >
                Close
              </button>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
