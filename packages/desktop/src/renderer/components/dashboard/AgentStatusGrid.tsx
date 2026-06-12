import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { StatusDot } from "../ui/StatusDot";
import { AgentDetailModal } from "../AgentDetailModal";
import { useNexus } from "../../contexts/NexusContext";
import type { AgentView } from "../../lib/nexus-bridge";

export function AgentStatusGrid() {
  const nexus = useNexus();
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentView | null>(null);

  useEffect(() => {
    nexus.getAgents().then(setAgents);
  }, [nexus]);

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
