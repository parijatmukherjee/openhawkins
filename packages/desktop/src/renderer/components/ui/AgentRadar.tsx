import { motion } from "framer-motion";

interface Agent {
  id: string;
  name: string;
  role: string;
  status: "active" | "busy" | "failed" | "idle";
  angle: number;
  distance: number;
}

const mockAgents: Agent[] = [
  { id: "research", name: "Research", role: "research", status: "active", angle: 30, distance: 0.6 },
  { id: "system", name: "System", role: "system", status: "busy", angle: 120, distance: 0.4 },
  { id: "weather", name: "Weather", role: "data", status: "active", angle: 210, distance: 0.7 },
  { id: "calendar", name: "Calendar", role: "data", status: "idle", angle: 300, distance: 0.5 },
  { id: "browser", name: "Browser", role: "browser", status: "failed", angle: 180, distance: 0.8 },
  { id: "vision", name: "Vision", role: "vision", status: "active", angle: 45, distance: 0.3 },
];

const statusColors = {
  active: "var(--status-success)",
  busy: "var(--status-warning)",
  failed: "var(--status-error)",
  idle: "var(--status-idle)",
};

export function AgentRadar() {
  return (
    <div className="relative w-64 h-64">
      {/* Radar rings */}
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <div
          key={scale}
          className="absolute rounded-full border border-neon-cyan/10"
          style={{
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
            top: `${(1 - scale) * 50}%`,
            left: `${(1 - scale) * 50}%`,
          }}
        />
      ))}

      {/* Crosshairs */}
      <div className="absolute top-0 left-1/2 w-px h-full bg-neon-cyan/5" />
      <div className="absolute top-1/2 left-0 w-full h-px bg-neon-cyan/5" />

      {/* Sweeping radar line */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-1/2 h-px origin-left"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,212,255,0.4) 0%, transparent 100%)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      {/* Agent blips */}
      {mockAgents.map((agent) => {
        const x = 50 + Math.cos((agent.angle * Math.PI) / 180) * agent.distance * 50;
        const y = 50 + Math.sin((agent.angle * Math.PI) / 180) * agent.distance * 50;

        return (
          <motion.div
            key={agent.id}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
            style={{ left: `${x}%`, top: `${y}%` }}
            whileHover={{ scale: 1.5 }}
            animate={{
              boxShadow: [
                `0 0 8px ${statusColors[agent.status]}`,
                `0 0 16px ${statusColors[agent.status]}`,
                `0 0 8px ${statusColors[agent.status]}`,
              ],
            }}
            transition={{
              boxShadow: { duration: 2, repeat: Infinity },
              scale: { duration: 0.2 },
            }}
          >
            <div
              className="w-full h-full rounded-full"
              style={{ backgroundColor: statusColors[agent.status] }}
            />
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-bg-panel border border-neon-cyan/20 rounded text-xs whitespace-nowrap opacity-0 hover:opacity-100 transition-opacity">
              {agent.name}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
