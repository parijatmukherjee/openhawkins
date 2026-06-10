import { describe, it, expect, vi } from "vitest";
import type { JarvisHub } from "../../src/e2e/mock-user.js";
import { MockUser } from "../../src/e2e/mock-user.js";
import type { VisualCommand } from "../../src/synthesis.js";
import type { VisionEvent } from "../../src/vision/events.js";
import type { BusEvent } from "../../src/event-bus.js";
import type { AuditEntry } from "@openhawkins/core";

function makeHub(): JarvisHub {
  return {
    wakeWordEngine: { start: vi.fn() },
    sttEngine: { transcribe: vi.fn() },
    ttsEngine: { getLastOutput: vi.fn() },
    displayManager: { getCommands: vi.fn() },
    visionEngine: { getEvents: vi.fn() },
    eventBus: { getEvents: vi.fn() },
    auditLog: { getEntries: vi.fn() },
  };
}

describe("MockUser", () => {
  it("can be constructed with a JarvisHub", () => {
    const hub = makeHub();
    const user = new MockUser(hub);
    expect(user).toBeDefined();
    expect(user).toBeInstanceOf(MockUser);
  });

  it("wake() calls hub.wakeWordEngine.start()", async () => {
    const hub = makeHub();
    const user = new MockUser(hub);
    await user.wake();
    expect(hub.wakeWordEngine.start).toHaveBeenCalledTimes(1);
    expect(hub.wakeWordEngine.start).toHaveBeenCalledWith(expect.any(Function));
  });

  it("say(text) calls hub.sttEngine.transcribe(text)", async () => {
    const hub = makeHub();
    const user = new MockUser(hub);
    await user.say("hello");
    expect(hub.sttEngine.transcribe).toHaveBeenCalledTimes(1);
    expect(hub.sttEngine.transcribe).toHaveBeenCalledWith("hello");
  });

  it("listen() returns hub.ttsEngine.getLastOutput()", () => {
    const hub = makeHub();
    hub.ttsEngine.getLastOutput = vi.fn().mockReturnValue("goodbye");
    const user = new MockUser(hub);
    const result = user.listen();
    expect(hub.ttsEngine.getLastOutput).toHaveBeenCalledTimes(1);
    expect(result).toBe("goodbye");
  });

  it("seeScreen() returns hub.displayManager.getCommands()", () => {
    const hub = makeHub();
    const commands: VisualCommand[] = [{ type: "show_text", text: "hello" }];
    hub.displayManager.getCommands = vi.fn().mockReturnValue(commands);
    const user = new MockUser(hub);
    const result = user.seeScreen();
    expect(hub.displayManager.getCommands).toHaveBeenCalledTimes(1);
    expect(result).toBe(commands);
  });

  it("seeVision() returns hub.visionEngine.getEvents()", () => {
    const hub = makeHub();
    const events: VisionEvent[] = [];
    hub.visionEngine.getEvents = vi.fn().mockReturnValue(events);
    const user = new MockUser(hub);
    const result = user.seeVision();
    expect(hub.visionEngine.getEvents).toHaveBeenCalledTimes(1);
    expect(result).toBe(events);
  });

  it("getEvents() returns hub.eventBus.getEvents()", () => {
    const hub = makeHub();
    const events: BusEvent[] = [];
    hub.eventBus.getEvents = vi.fn().mockReturnValue(events);
    const user = new MockUser(hub);
    const result = user.getEvents();
    expect(hub.eventBus.getEvents).toHaveBeenCalledTimes(1);
    expect(result).toBe(events);
  });

  it("getAudit() returns hub.auditLog.getEntries()", () => {
    const hub = makeHub();
    const entries: AuditEntry[] = [];
    hub.auditLog.getEntries = vi.fn().mockReturnValue(entries);
    const user = new MockUser(hub);
    const result = user.getAudit();
    expect(hub.auditLog.getEntries).toHaveBeenCalledTimes(1);
    expect(result).toBe(entries);
  });
});
