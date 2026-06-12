import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../ui/GlassPanel";
import { useNexus } from "../../contexts/NexusContext";
import type { MessageView } from "../../lib/nexus-bridge";

export function ConversationPanel() {
  const nexus = useNexus();
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<MessageView[]>([]);

  useEffect(() => {
    nexus.getMessages().then(setMessages);
  }, [nexus]);

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
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-3/4 px-3 py-2 rounded-lg text-sm ${
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
