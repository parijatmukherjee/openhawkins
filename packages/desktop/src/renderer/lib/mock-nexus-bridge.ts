import type { NexusBridge, AgentView, MessageView } from "./nexus-bridge.js";
import type { Task } from "@openjarvis/jarvis/nexus";

// Mock bridge that returns the same data currently hardcoded in components.
// In a real Electron app, this would be replaced with an IPC bridge to the
// main process where NexusEngine lives.

const mockAgents: AgentView[] = [
  {
    id: "research",
    name: "Research",
    role: "Research",
    status: "active",
    description: "Web search and information gathering",
    capabilities: ["search", "browse", "summarize"],
    lastActivity: "2m ago",
    tasksCompleted: 142,
  },
  {
    id: "system",
    name: "System",
    role: "System",
    status: "busy",
    description: "System operations and file management",
    capabilities: ["shell", "fs:read", "fs:write"],
    lastActivity: "now",
    tasksCompleted: 89,
  },
  {
    id: "weather",
    name: "Weather",
    role: "Data",
    status: "active",
    description: "Weather data retrieval and forecasts",
    capabilities: ["weather:fetch", "location"],
    lastActivity: "5m ago",
    tasksCompleted: 256,
  },
  {
    id: "calendar",
    name: "Calendar",
    role: "Data",
    status: "idle",
    description: "Calendar events and scheduling",
    capabilities: ["calendar:read", "calendar:write", "reminder"],
    lastActivity: "1h ago",
    tasksCompleted: 67,
  },
  {
    id: "browser",
    name: "Browser",
    role: "Browser",
    status: "failed",
    description: "Web browser automation",
    capabilities: ["browse", "click", "screenshot"],
    lastActivity: "3h ago",
    tasksCompleted: 34,
  },
  {
    id: "vision",
    name: "Vision",
    role: "Vision",
    status: "active",
    description: "Visual recognition and screen analysis",
    capabilities: ["detect", "ocr", "classify"],
    lastActivity: "1m ago",
    tasksCompleted: 198,
  },
];

const mockTasks: Task[] = [
  {
    id: "1",
    agentId: "weather",
    description: "Fetching weather data",
    status: "running",
    startedAt: Date.now() - 1200,
    durationMs: 1200,
  },
  {
    id: "2",
    agentId: "calendar",
    description: "Loading calendar events",
    status: "completed",
    startedAt: Date.now() - 800,
    durationMs: 800,
  },
  {
    id: "3",
    agentId: "research",
    description: "Web search: AI trends 2025",
    status: "pending",
    startedAt: Date.now(),
  },
  {
    id: "4",
    agentId: "system",
    description: "Opening Calendar app",
    status: "completed",
    startedAt: Date.now() - 300,
    durationMs: 300,
  },
];

const mockMessages: MessageView[] = [
  { id: "1", type: "user", text: "What's the weather like?", timestamp: "10:23 AM" },
  {
    id: "2",
    type: "jarvis",
    text: "It's 72°F and sunny. Would you like me to open the weather app?",
    timestamp: "10:23 AM",
  },
  { id: "3", type: "system", text: "Agent 'weather' dispatched", timestamp: "10:23 AM" },
  { id: "4", type: "user", text: "Yes, please", timestamp: "10:24 AM" },
  { id: "5", type: "jarvis", text: "Done. Calendar app opened.", timestamp: "10:24 AM" },
];

export function createMockNexusBridge(): NexusBridge {
  return {
    async getTasks() {
      return mockTasks;
    },
    async getAgents() {
      return mockAgents;
    },
    async getMessages() {
      return mockMessages;
    },
    async executeIntent(action, params) {
      console.log("Mock executeIntent:", action, params);
    },
    subscribeToEvents() {
      return () => {};
    },
  };
}
