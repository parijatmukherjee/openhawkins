import { useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { StatusDot } from "../ui/StatusDot";
import { AgentDetailModal } from "../AgentDetailModal";

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: "active" | "busy" | "failed" | "idle";
  description: string;
  capabilities: string[];
  lastActivity: string;
  tasksCompleted: number;
}

const agents: AgentInfo[] = [
  { id: "research", name: "Research", role: "Research", status: "active", description: "Web search and information gathering", capabilities: ["search", "browse", "summarize"], lastActivity: "2m ago", tasksCompleted: 142 },
  { id: "system", name: "System", role: "System", status: "busy", description: "System operations and file management", capabilities: ["shell", "fs:read", "fs:write"], lastActivity: "now", tasksCompleted: 89 },
  { id: "weather", name: "Weather", role: "Data", status: "active", description: "Weather data retrieval and forecasts", capabilities: ["weather:fetch", "location"], lastActivity: "5m ago", tasksCompleted: 256 },
  { id: "calendar", name: "Calendar", role: "Data", status: "idle", description: "Calendar events and scheduling", capabilities: ["calendar:read", "calendar:write", "reminder"], lastActivity: "1h ago", tasksCompleted: 67 },
  { id: "browser", name: "Browser", role: "Browser", status: "failed", description: "Web browser automation", capabilities: ["browse", "click", "screenshot"], lastActivity: "3h ago", tasksCompleted: 34 },
  { id: "vision", name: "Vision", role: "Vision", status: "active", description: "Visual recognition and screen analysis", capabilities: ["detect", "ocr", "classify"], lastActivity: "1m ago", tasksCompleted: 198 },
];

export function AgentStatusGrid() {
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);

  return (
    <>
      <GlassPanel className="p-6">
        <h2 className="text-lg font-medium mb-4">Agents</h2>
        <div className="grid grid-cols-3 gap-3">
          {agents.map((agent, index) => (
            <motion.div
              key={agent.id}
              className="p-3 rounded-lg bg-white/5 border border-white/5 hover:border-neon-cyan/30 transition-all cursor-pointer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.2 }}
              whileHover={{ y: -2, boxShadow: "var(--glow-cyan)" }}
              onClick={() => setSelectedAgent(agent)}
            >
              <div className="flex flex-col items-center gap-2">
                <StatusDot status={agent.status} size="lg" pulse={agent.status === "active"} />
                <span className="text-xs font-medium text-center">{agent.name}</span>
                <span className="text-xs text-text-secondary">{agent.role}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </GlassPanel>

      <AgentDetailModal
        agent={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </>
  );
}
