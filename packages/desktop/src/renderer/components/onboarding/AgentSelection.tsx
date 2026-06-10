import { useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { NeonButton } from "../ui/NeonButton";
import { StatusDot } from "../ui/StatusDot";

interface Agent {
  id: string;
  name: string;
  role: string;
  enabled: boolean;
}

const defaultAgents: Agent[] = [
  { id: "research", name: "Research", role: "Research", enabled: true },
  { id: "system", name: "System", role: "System", enabled: true },
  { id: "weather", name: "Weather", role: "Data", enabled: true },
  { id: "calendar", name: "Calendar", role: "Data", enabled: true },
  { id: "browser", name: "Browser", role: "Browser", enabled: false },
  { id: "vision", name: "Vision", role: "Vision", enabled: true },
];

interface AgentSelectionProps {
  onNext: () => void;
}

export function AgentSelection({ onNext }: AgentSelectionProps) {
  const [agents, setAgents] = useState(defaultAgents);

  const toggleAgent = (id: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const enabledCount = agents.filter((a) => a.enabled).length;

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-bg-deep px-6">
      <motion.div
        className="max-w-lg w-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl font-light tracking-tight text-center mb-2">
          Select Agents
        </h2>
        <p className="text-text-secondary text-center mb-8">
          {enabledCount} of {agents.length} agents enabled
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {agents.map((agent, index) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <GlassPanel
                glow={agent.enabled ? "cyan-strong" : "none"}
                onClick={() => toggleAgent(agent.id)}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-3 p-4">
                  <StatusDot
                    status={agent.enabled ? "success" : "idle"}
                    size="lg"
                    pulse={agent.enabled}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-xs text-text-secondary">{agent.role}</div>
                  </div>
                  <div
                    className={`w-10 h-6 rounded-full p-1 transition-colors ${
                      agent.enabled ? "bg-neon-cyan/30" : "bg-white/10"
                    }`}
                  >
                    <motion.div
                      className="w-4 h-4 rounded-full bg-white"
                      animate={{ x: agent.enabled ? 16 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </div>
                </div>
              </GlassPanel>
            </motion.div>
          ))}
        </div>

        <div className="flex justify-center">
          <NeonButton onClick={onNext}>Continue</NeonButton>
        </div>
      </motion.div>
    </div>
  );
}
