import { motion } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { StatusDot } from "../ui/StatusDot";

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: "active" | "busy" | "failed" | "idle";
}

const agents: AgentInfo[] = [
  { id: "research", name: "Research", role: "Research", status: "active" },
  { id: "system", name: "System", role: "System", status: "busy" },
  { id: "weather", name: "Weather", role: "Data", status: "active" },
  { id: "calendar", name: "Calendar", role: "Data", status: "idle" },
  { id: "browser", name: "Browser", role: "Browser", status: "failed" },
  { id: "vision", name: "Vision", role: "Vision", status: "active" },
];

export function AgentStatusGrid() {
  return (
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
  );
}
