import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";

interface Message {
  id: string;
  type: "user" | "jarvis" | "system";
  text: string;
  timestamp: string;
}

const mockMessages: Message[] = [
  { id: "1", type: "user", text: "What's the weather like?", timestamp: "10:23 AM" },
  { id: "2", type: "jarvis", text: "It's 72°F and sunny. Would you like me to open the weather app?", timestamp: "10:23 AM" },
  { id: "3", type: "system", text: "Agent 'weather' dispatched", timestamp: "10:23 AM" },
  { id: "4", type: "user", text: "Yes, please", timestamp: "10:24 AM" },
  { id: "5", type: "jarvis", text: "Done. Calendar app opened.", timestamp: "10:24 AM" },
];

export function ConversationPanel() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="relative">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <GlassPanel className="p-4 mb-2 max-h-64 overflow-y-auto">
              <div className="space-y-3">
                {mockMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.type === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                        msg.type === "user"
                          ? "bg-neon-cyan/10 border border-neon-cyan/20"
                          : msg.type === "jarvis"
                            ? "bg-white/5 border border-neon-cyan/10"
                            : "bg-transparent text-text-secondary font-mono text-xs"
                      }`}
                    >
                      {msg.text}
                      <span className="block text-xs text-text-secondary mt-1">
                        {msg.timestamp}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full py-2 text-center text-sm text-text-secondary hover:text-neon-cyan transition-colors"
      >
        {isExpanded ? "▲ Hide conversation" : "▼ Show conversation"}
      </button>
    </div>
  );
}
