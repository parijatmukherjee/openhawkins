import type { EventBus } from "../event-bus.js";

export interface Task {
  id: string;
  agentId: string;
  description: string;
  sessionId?: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

export class TaskBoard {
  private tasks: Map<string, Task> = new Map();

  constructor(eventBus: EventBus) {
    eventBus.subscribe("nexus", (event) => {
      const payload = event.payload as { type: string; [key: string]: unknown };
      if (payload.type === "task_started") {
        this.tasks.set(payload.taskId as string, {
          id: payload.taskId as string,
          agentId: payload.agentId as string,
          description: payload.description as string,
          sessionId: payload.sessionId as string,
          status: "running",
          startedAt: payload.at as number,
        });
      } else if (payload.type === "task_completed") {
        const task = this.tasks.get(payload.taskId as string);
        if (task) {
          task.status = payload.success ? "completed" : "failed";
          task.completedAt = payload.at as number;
          task.durationMs = task.completedAt - task.startedAt;
        }
      }
    });
  }

  async getActiveTasks(sessionId?: string): Promise<Task[]> {
    const tasks = Array.from(this.tasks.values());
    if (sessionId) {
      return tasks.filter((t) => t.status === "running" && t.sessionId === sessionId);
    }
    return tasks.filter((t) => t.status === "running");
  }

  async getTaskHistory(sessionId?: string, limit?: number): Promise<Task[]> {
    const tasks = Array.from(this.tasks.values());
    let filtered = tasks;
    if (sessionId) {
      filtered = tasks.filter((t) => t.sessionId === sessionId);
    }
    const sorted = filtered.sort((a, b) => b.startedAt - a.startedAt);
    return limit ? sorted.slice(0, limit) : sorted;
  }
}
