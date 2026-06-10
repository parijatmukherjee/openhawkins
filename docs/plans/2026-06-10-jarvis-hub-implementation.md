# J1 — Jarvis Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@openhawkins/jarvis` hub architecture as specified in [`docs/specs/2026-06-10-jarvis-hub-architecture.md`](../specs/2026-06-10-jarvis-hub-architecture.md), making the codebase match the Jarvis vision.

**Architecture:** Create `@openhawkins/jarvis` as the top-level orchestrator package that reuses all existing packages (`core`, `state`, `memory`, `security`) as libraries. All new interfaces are pluggable; v1 ships with mock implementations for voice and display.

**Tech Stack:** TypeScript (strict ESM, `.js` specifiers), Vitest, Node.js `worker_threads`, `child_process`, SQLite.

---

## Phase 1: Foundation (packages and interfaces)

### Task 1.1: Create `@openhawkins/jarvis` package skeleton

**Files:**
- Create: `packages/jarvis/package.json`
- Create: `packages/jarvis/tsconfig.json`
- Create: `packages/jarvis/tsconfig.test.json`
- Create: `packages/jarvis/src/index.ts`
- Modify: `package.json` (workspaces)
- Modify: `tsconfig.json` (references)
- Test: `packages/jarvis/test/package.test.ts`

```json
// packages/jarvis/package.json
{
  "name": "@openhawkins/jarvis",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "@openhawkins/core": "*",
    "@openhawkins/state": "*",
    "@openhawkins/memory": "*",
    "@openhawkins/agents": "*",
    "@openhawkins/skills": "*"
  }
}
```

- [ ] **Step 1: Create package.json**
- [ ] **Step 2: Create tsconfig.json extending base**
- [ ] **Step 3: Create src/index.ts** (re-export all public types)
- [ ] **Step 4: Add to root workspaces**
- [ ] **Step 5: Build passes**

---

### Task 1.2: Define core interfaces

**Files:**
- Create: `packages/jarvis/src/intent.ts`
- Create: `packages/jarvis/src/context.ts`
- Create: `packages/jarvis/src/synthesis.ts`
- Create: `packages/jarvis/src/persona.ts`
- Test: `packages/jarvis/test/interfaces.test.ts`

```typescript
// packages/jarvis/src/intent.ts
export interface Intent {
  action: string;
  params: Record<string, unknown>;
  confidence: number;
  ambiguous: boolean;
  suggestedClarification?: string;
}

export interface IntentParser {
  parse(input: string, context: JarvisContext): Promise<Intent>;
}

// packages/jarvis/src/context.ts
export interface JarvisContext {
  sessionId: string;
  userId: string;
  recentIntents: Intent[];
  currentTime: Date;
  location?: string;
}

// packages/jarvis/src/synthesis.ts
export interface Synthesis {
  spoken: string;
  visual?: VisualCommand[];
  action?: string;
}

export type VisualCommand =
  | { type: "open_app"; app: string; monitor?: number }
  | { type: "open_url"; url: string; monitor?: number }
  | { type: "show_text"; text: string; monitor?: number }
  | { type: "highlight"; element: string; monitor?: number }
  | { type: "clear"; monitor?: number };

// packages/jarvis/src/persona.ts
export interface Persona {
  name: string;
  voice: VoiceProfile;
  greeting: string;
  farewell: string;
  tone: "formal" | "casual" | "professional";
  injectIntoSystemPrompt(base: string): string;
}

export interface VoiceProfile {
  engine: string;
  model?: string;
  speed: number;
  pitch: number;
}
```

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Implement interfaces**
- [ ] **Step 3: Test passes**

---

### Task 1.3: Define voice pipeline interfaces

**Files:**
- Create: `packages/jarvis/src/voice/wake-word.ts`
- Create: `packages/jarvis/src/voice/stt.ts`
- Create: `packages/jarvis/src/voice/tts.ts`
- Create: `packages/jarvis/src/voice/audio.ts`
- Create: `packages/jarvis/src/voice/index.ts`
- Test: `packages/jarvis/test/voice/interfaces.test.ts`

```typescript
export interface WakeWordEngine {
  start(callback: () => void): Promise<void>;
  stop(): Promise<void>;
}

export interface SttEngine {
  transcribe(audioStream: ReadableStream<Uint8Array>): Promise<string>;
}

export interface TtsEngine {
  synthesize(text: string): Promise<ReadableStream<Uint8Array>>;
}

export interface AudioInput {
  open(): Promise<ReadableStream<Uint8Array>>;
  close(): Promise<void>;
}

export interface AudioOutput {
  play(stream: ReadableStream<Uint8Array>): Promise<void>;
}
```

---

### Task 1.4: Define display manager interface

**Files:**
- Create: `packages/jarvis/src/display/display-manager.ts`
- Create: `packages/jarvis/src/display/index.ts`
- Test: `packages/jarvis/test/display/interfaces.test.ts`

```typescript
export interface DisplayManager {
  listDisplays(): Promise<DisplayInfo[]>;
  openApp(app: string, displayId?: string): Promise<void>;
  openUrl(url: string, displayId?: string): Promise<void>;
  showText(text: string, displayId?: string): Promise<void>;
  clear(displayId?: string): Promise<void>;
}

export interface DisplayInfo {
  id: string;
  name: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}
```

---

### Task 1.5: Define delegator and agent pool interfaces

**Files:**
- Create: `packages/jarvis/src/agents/delegator.ts`
- Create: `packages/jarvis/src/agents/pool.ts`
- Create: `packages/jarvis/src/agents/index.ts`
- Test: `packages/jarvis/test/agents/interfaces.test.ts`

```typescript
export interface Delegator {
  delegate(intent: Intent, context: JarvisContext): Promise<AgentResult[]>;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  output: unknown;
  success: boolean;
  error?: string;
  auditEntry: AuditEntry;
}

export interface AgentPool {
  getAvailableAgents(): Promise<AgentInfo[]>;
  spawn(agentId: string, config: AgentConfig): Promise<AgentHandle>;
  kill(handle: AgentHandle): Promise<void>;
}

export interface AgentHandle {
  id: string;
  process: unknown; // ChildProcess or Worker
  grant: AgentGrant;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  capabilities: CapabilityName[];
}
```

---

### Task 1.6: Define scheduler and event bus interfaces

**Files:**
- Create: `packages/jarvis/src/scheduler.ts`
- Create: `packages/jarvis/src/event-bus.ts`
- Test: `packages/jarvis/test/scheduler.test.ts`
- Test: `packages/jarvis/test/event-bus.test.ts`

---

### Task 1.7: Create `@openhawkins/agents` package skeleton

**Files:**
- Create: `packages/agents/package.json`
- Create: `packages/agents/tsconfig.json`
- Create: `packages/agents/src/index.ts`
- Create: `packages/agents/src/factory.ts`
- Create: `packages/agents/src/built-in/` (research, system, code, vision, comm, memory, creative)
- Modify: `package.json`, `tsconfig.json`

---

### Task 1.8: Create `@openhawkins/skills` package skeleton

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/src/index.ts`
- Create: `packages/skills/src/manifest.ts`
- Create: `packages/skills/src/loader.ts`
- Create: `packages/skills/src/sandbox.ts`
- Modify: `package.json`, `tsconfig.json`

---

### Task 1.9: Create `@openhawkins/desktop` package skeleton (Electron)

**Files:**
- Create: `packages/desktop/package.json`
- Create: `packages/desktop/tsconfig.json`
- Create: `packages/desktop/src/main.ts`
- Create: `packages/desktop/src/preload.ts`
- Create: `packages/desktop/src/renderer/index.html`
- Create: `packages/desktop/electron-builder.json`
- Modify: `package.json`, `tsconfig.json`

---

## Phase 2: Mock implementations (v1)

### Task 2.1: Implement mock voice pipeline

**Files:**
- Create: `packages/jarvis/src/voice/mock.ts`
- Test: `packages/jarvis/test/voice/mock.test.ts`

```typescript
export class MockWakeWordEngine implements WakeWordEngine {
  private callback?: () => void;
  
  async start(callback: () => void): Promise<void> {
    this.callback = callback;
    // Listen for keyboard shortcut
    process.stdin.on("keypress", (_, key) => {
      if (key?.ctrl && key?.name === "j") {
        this.callback?.();
      }
    });
  }
  
  async stop(): Promise<void> {
    this.callback = undefined;
  }
}

export class MockSttEngine implements SttEngine {
  async transcribe(): Promise<string> {
    // In a real implementation, read from audio stream
    // For mock, return a fixed test string
    return "open my calendar";
  }
}

export class MockTtsEngine implements TtsEngine {
  async synthesize(text: string): Promise<ReadableStream<Uint8Array>> {
    console.log(`[Jarvis says]: ${text}`);
    // Return empty stream
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  }
}
```

---

### Task 2.2: Implement mock display manager

**Files:**
- Create: `packages/jarvis/src/display/mock.ts`
- Test: `packages/jarvis/test/display/mock.test.ts`

```typescript
export class MockDisplayManager implements DisplayManager {
  async listDisplays(): Promise<DisplayInfo[]> {
    return [{ id: "display-1", name: "Primary", primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  }
  
  async openApp(app: string, displayId?: string): Promise<void> {
    console.log(`[Display] open_app: ${app} on ${displayId || "primary"}`);
  }
  
  async openUrl(url: string, displayId?: string): Promise<void> {
    console.log(`[Display] open_url: ${url} on ${displayId || "primary"}`);
  }
  
  async showText(text: string, displayId?: string): Promise<void> {
    console.log(`[Display] show_text: "${text}" on ${displayId || "primary"}`);
  }
  
  async clear(displayId?: string): Promise<void> {
    console.log(`[Display] clear on ${displayId || "primary"}`);
  }
}
```

---

### Task 2.3: Implement simple rule-based intent parser

**Files:**
- Create: `packages/jarvis/src/intent/rule-based.ts`
- Test: `packages/jarvis/test/intent/rule-based.test.ts`

```typescript
export class RuleBasedIntentParser implements IntentParser {
  async parse(input: string, context: JarvisContext): Promise<Intent> {
    const normalized = input.toLowerCase().trim();
    
    if (normalized.includes("open")) {
      const app = normalized.replace("open", "").trim();
      return { action: "open_app", params: { app }, confidence: 0.9, ambiguous: false };
    }
    
    if (normalized.includes("search")) {
      const query = normalized.replace("search", "").replace("for", "").trim();
      return { action: "search", params: { query }, confidence: 0.85, ambiguous: false };
    }
    
    if (normalized.includes("update")) {
      return { action: "get_updates", params: {}, confidence: 0.8, ambiguous: false };
    }
    
    return { action: "unknown", params: { text: input }, confidence: 0.3, ambiguous: true, suggestedClarification: "Could you rephrase that?" };
  }
}
```

---

### Task 2.4: Implement synthesizer

**Files:**
- Create: `packages/jarvis/src/synthesis/simple.ts`
- Test: `packages/jarvis/test/synthesis/simple.test.ts`

```typescript
export class SimpleSynthesizer implements Synthesizer {
  async synthesize(results: AgentResult[], originalIntent: Intent, context: JarvisContext): Promise<Synthesis> {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    
    let spoken = "";
    
    if (successful.length === 0) {
      spoken = "I wasn't able to complete that task. " + (failed[0]?.error || "");
    } else if (successful.length === 1) {
      spoken = `Done. ${successful[0].agentName} completed the task.`;
    } else {
      spoken = `Done. I've completed ${successful.length} tasks for you.`;
    }
    
    const visual: VisualCommand[] = [];
    
    if (originalIntent.action === "open_app" && originalIntent.params.app) {
      visual.push({ type: "open_app", app: String(originalIntent.params.app) });
    }
    
    return { spoken, visual };
  }
}
```

---

### Task 2.5: Implement the Jarvis orchestrator

**Files:**
- Create: `packages/jarvis/src/hub.ts`
- Test: `packages/jarvis/test/hub.test.ts`

```typescript
export interface JarvisHubConfig {
  persona: Persona;
  intentParser: IntentParser;
  delegator: Delegator;
  synthesizer: Synthesizer;
  displayManager: DisplayManager;
  ttsEngine: TtsEngine;
  wakeWordEngine: WakeWordEngine;
  scheduler: Scheduler;
  eventBus: EventBus;
}

export class JarvisHub {
  private state: "idle" | "listening" | "thinking" | "responding" = "idle";
  
  constructor(private readonly config: JarvisHubConfig) {}
  
  async start(): Promise<void> {
    await this.config.wakeWordEngine.start(() => this.onWakeWord());
  }
  
  async stop(): Promise<void> {
    await this.config.wakeWordEngine.stop();
  }
  
  private async onWakeWord(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "listening";
    
    // Mock: read from keyboard
    const input = await this.readInput();
    
    this.state = "thinking";
    const context = this.buildContext();
    const intent = await this.config.intentParser.parse(input, context);
    
    if (intent.ambiguous) {
      await this.speak(intent.suggestedClarification || "I'm not sure what you mean.");
      this.state = "idle";
      return;
    }
    
    const results = await this.config.delegator.delegate(intent, context);
    const synthesis = await this.config.synthesizer.synthesize(results, intent, context);
    
    this.state = "responding";
    await this.speak(synthesis.spoken);
    
    if (synthesis.visual) {
      for (const cmd of synthesis.visual) {
        await this.executeVisualCommand(cmd);
      }
    }
    
    this.state = "idle";
  }
  
  private async readInput(): Promise<string> {
    // Mock implementation: read from stdin
    return new Promise((resolve) => {
      process.stdout.write("You: ");
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });
  }
  
  private async speak(text: string): Promise<void> {
    const stream = await this.config.ttsEngine.synthesize(text);
    // Mock: just log
    console.log(`[Jarvis]: ${text}`);
  }
  
  private async executeVisualCommand(cmd: VisualCommand): Promise<void> {
    switch (cmd.type) {
      case "open_app":
        await this.config.displayManager.openApp(cmd.app, cmd.monitor?.toString());
        break;
      case "open_url":
        await this.config.displayManager.openUrl(cmd.url, cmd.monitor?.toString());
        break;
      case "show_text":
        await this.config.displayManager.showText(cmd.text, cmd.monitor?.toString());
        break;
      case "clear":
        await this.config.displayManager.clear(cmd.monitor?.toString());
        break;
    }
  }
  
  private buildContext(): JarvisContext {
    return {
      sessionId: crypto.randomUUID(),
      userId: "default-user",
      recentIntents: [],
      currentTime: new Date(),
    };
  }
}
```

---

## Phase 3: Built-in agents

### Task 3.1: Implement Research Agent

**Files:**
- Create: `packages/agents/src/research.ts`
- Test: `packages/agents/test/research.test.ts`

### Task 3.2: Implement System Agent

**Files:**
- Create: `packages/agents/src/system.ts`
- Test: `packages/agents/test/system.test.ts`

### Task 3.3: Implement Code Agent

**Files:**
- Create: `packages/agents/src/code.ts`
- Test: `packages/agents/test/code.test.ts`

### Task 3.4: Implement Vision Agent

**Files:**
- Create: `packages/agents/src/vision.ts`
- Test: `packages/agents/test/vision.test.ts`

### Task 3.5: Implement Comm Agent

**Files:**
- Create: `packages/agents/src/comm.ts`
- Test: `packages/agents/test/comm.test.ts`

### Task 3.6: Implement Memory Agent

**Files:**
- Create: `packages/agents/src/memory.ts`
- Test: `packages/agents/test/memory.test.ts`

### Task 3.7: Implement Creative Agent

**Files:**
- Create: `packages/agents/src/creative.ts`
- Test: `packages/agents/test/creative.test.ts`

---

## Phase 4: Skills system

### Task 4.1: SKILL.md manifest parser

**Files:**
- Create: `packages/skills/src/manifest.ts`
- Create: `packages/skills/src/schema.ts` (Zod schema for manifest validation)
- Test: `packages/skills/test/manifest.test.ts`

### Task 4.2: Skill loader

**Files:**
- Create: `packages/skills/src/loader.ts`
- Test: `packages/skills/test/loader.test.ts`

### Task 4.3: Capability-gated sandbox

**Files:**
- Create: `packages/skills/src/sandbox.ts`
- Test: `packages/skills/test/sandbox.test.ts`

---

## Phase 5: Integration and CLI

### Task 5.1: Create `jarvis` CLI entrypoint

**Files:**
- Create: `packages/jarvis/src/bin/jarvis.ts`
- Modify: `packages/jarvis/package.json` (add `"bin": { "jarvis": "./dist/bin/jarvis.js" }`)

```typescript
#!/usr/bin/env node
import { JarvisHub } from "../hub.js";
import { MockWakeWordEngine, MockSttEngine, MockTtsEngine } from "../voice/mock.js";
import { MockDisplayManager } from "../display/mock.js";
import { RuleBasedIntentParser } from "../intent/rule-based.js";
import { SimpleSynthesizer } from "../synthesis/simple.js";
import { SimpleDelegator } from "../agents/delegator.js";

const hub = new JarvisHub({
  persona: { name: "Jarvis", voice: { engine: "mock", speed: 1, pitch: 1 }, greeting: "Hello.", farewell: "Goodbye.", tone: "professional", injectIntoSystemPrompt: (b) => b },
  intentParser: new RuleBasedIntentParser(),
  delegator: new SimpleDelegator(),
  synthesizer: new SimpleSynthesizer(),
  displayManager: new MockDisplayManager(),
  ttsEngine: new MockTtsEngine(),
  wakeWordEngine: new MockWakeWordEngine(),
  scheduler: new SimpleScheduler(),
  eventBus: new SimpleEventBus(),
});

hub.start();
console.log("Jarvis is running. Press Ctrl+J to wake.");
```

### Task 5.2: Wire into root CLI

**Files:**
- Modify: `packages/cli/src/index.ts` (or create `packages/cli` if not exists)
- Add: `openhawkins jarvis` command

---

## Phase 6: State schema migration

### Task 6.1: Add skills and agents tables to state schema

**Files:**
- Modify: `packages/state/src/schema.ts`
- Test: `packages/state/test/schema.test.ts`

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  path TEXT NOT NULL,
  manifest TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER,
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  config TEXT NOT NULL,
  grant TEXT NOT NULL
);
```

### Task 6.2: Add Jarvis event types to event store

**Files:**
- Modify: `packages/core/src/session/events.ts`
- Add: `JarvisEvent` variants (WakeWordDetected, IntentParsed, AgentDelegated, etc.)

---

## Phase 7: Documentation updates

### Task 7.1: Update `docs/vision.md`

Add J1 completion status to the Current vs Vision delta table.

### Task 7.2: Update `CHECKPOINT.md`

Add J1 implementation status and next phases.

### Task 7.3: Update `docs/specs/2026-06-10-jarvis-hub-architecture.md`

Mark sections as implemented.

---

## Final Gate

```bash
npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional
```

Then:

```bash
docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test
```

All must pass before merge.

---

*Plan written 2026-06-10. Estimated: 30+ tasks, ~2-3 weeks of implementation time.*
