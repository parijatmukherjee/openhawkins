import { describe, it, expect, vi } from "vitest";
import { ProcessEventBus, type ProcessEvent } from "../src/events.js";

describe("ProcessEventBus", () => {
  it("emits and listens to events", () => {
    const bus = new ProcessEventBus();
    const handler = vi.fn();
    bus.on("phase-started", handler);

    const event: ProcessEvent = {
      id: "1",
      type: "phase-started",
      phaseId: "research",
      timestamp: Date.now(),
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("supports multiple listeners", () => {
    const bus = new ProcessEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("phase-completed", handler1);
    bus.on("phase-completed", handler2);

    const event: ProcessEvent = {
      id: "2",
      type: "phase-completed",
      phaseId: "plan",
      timestamp: Date.now(),
    };
    bus.emit(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it("replays events from log", () => {
    const bus = new ProcessEventBus();
    const event1: ProcessEvent = {
      id: "1",
      type: "phase-started",
      phaseId: "research",
      timestamp: 1,
    };
    const event2: ProcessEvent = {
      id: "2",
      type: "phase-completed",
      phaseId: "research",
      timestamp: 2,
    };
    bus.emit(event1);
    bus.emit(event2);

    const replayed = bus.replay();
    expect(replayed).toHaveLength(2);
    expect(replayed[0]).toEqual(event1);
  });

  it("replays filtered events", () => {
    const bus = new ProcessEventBus();
    bus.emit({ id: "1", type: "phase-started", phaseId: "research", timestamp: 1 });
    bus.emit({ id: "2", type: "phase-completed", phaseId: "research", timestamp: 2 });

    const replayed = bus.replay("phase-completed");
    expect(replayed).toHaveLength(1);
    expect(replayed[0].type).toBe("phase-completed");
  });

  it("allows unsubscribing", () => {
    const bus = new ProcessEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("phase-started", handler);

    unsubscribe();

    bus.emit({ id: "1", type: "phase-started", phaseId: "research", timestamp: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears event log and listeners", () => {
    const bus = new ProcessEventBus();
    bus.emit({ id: "1", type: "phase-started", phaseId: "research", timestamp: 1 });
    bus.clear();
    expect(bus.replay()).toHaveLength(0);
  });
});
