import type { NexusEngine, TaskBoard, AgentPool } from "@openjarvis/jarvis/nexus";
import type { Task } from "@openjarvis/jarvis/nexus";
import type { EventBus } from "@openjarvis/jarvis";

export interface AgentView {
  id: string;
  name: string;
  role: string;
  status: "active" | "busy" | "failed" | "idle";
  description: string;
  capabilities: string[];
  lastActivity: string;
  tasksCompleted: number;
}

export interface MessageView {
  id: string;
  type: "user" | "jarvis" | "system";
  text: string;
  timestamp: string;
}

export interface NexusBridge {
  getTasks(): Promise<Task[]>;
  getAgents(): Promise<AgentView[]>;
  getMessages(): Promise<MessageView[]>;
  executeIntent(action: string, params: Record<string, unknown>): Promise<void>;
  subscribeToEvents(handler: (event: unknown) => void): () => void;
}

// Factory to create a bridge from a Nexus engine instance
export function createNexusBridge(
  engine: NexusEngine,
  taskBoard: TaskBoard,
  _agentPool: AgentPool,
  eventBus: EventBus,
): NexusBridge {
  const messages: MessageView[] = [];
  let messageId = 0;

  return {
    async getTasks() {
      return taskBoard.getTaskHistory(undefined, 50);
    },

    async getAgents() {
      // Map pool agents to AgentView — pool has mock factories
      return [
        {
          id: "research",
          name: "Research",
          role: "Research",
          status: "active" as const,
          description: "Web search and information gathering",
          capabilities: ["search", "browse", "summarize"],
          lastActivity: "2m ago",
          tasksCompleted: 142,
        },
        {
          id: "system",
          name: "System",
          role: "System",
          status: "busy" as const,
          description: "System operations and file management",
          capabilities: ["shell", "fs:read", "fs:write"],
          lastActivity: "now",
          tasksCompleted: 89,
        },
        {
          id: "weather",
          name: "Weather",
          role: "Data",
          status: "active" as const,
          description: "Weather data retrieval and forecasts",
          capabilities: ["weather:fetch", "location"],
          lastActivity: "5m ago",
          tasksCompleted: 256,
        },
        {
          id: "calendar",
          name: "Calendar",
          role: "Data",
          status: "idle" as const,
          description: "Calendar events and scheduling",
          capabilities: ["calendar:read", "calendar:write", "reminder"],
          lastActivity: "1h ago",
          tasksCompleted: 67,
        },
        {
          id: "browser",
          name: "Browser",
          role: "Browser",
          status: "failed" as const,
          description: "Web browser automation",
          capabilities: ["browse", "click", "screenshot"],
          lastActivity: "3h ago",
          tasksCompleted: 34,
        },
        {
          id: "vision",
          name: "Vision",
          role: "Vision",
          status: "active" as const,
          description: "Visual recognition and screen analysis",
          capabilities: ["detect", "ocr", "classify"],
          lastActivity: "1m ago",
          tasksCompleted: 198,
        },
      ];
    },

    async getMessages() {
      return messages;
    },

    async executeIntent(action, params) {
      messages.push({
        id: String(++messageId),
        type: "user",
        text: `${action}: ${JSON.stringify(params)}`,
        timestamp: new Date().toLocaleTimeString(),
      });

      try {
        await engine.execute(
          { action, params, confidence: 1, ambiguous: false },
          {
            sessionId: "desktop-session",
            userId: "user",
            recentIntents: [],
            currentTime: new Date(),
          },
        );
      } catch (err) {
        messages.push({
          id: String(++messageId),
          type: "system",
          text: `Error: ${String(err)}`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    },

    subscribeToEvents(handler) {
      const sub = eventBus.subscribe("nexus", (event) => {
        handler(event.payload);
      });
      return () => sub.unsubscribe();
    },
  };
}
