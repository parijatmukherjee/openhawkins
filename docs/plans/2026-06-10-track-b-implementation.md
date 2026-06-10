# Track B Implementation Plan — Device Identity, CRDT Sync, Multi-Device

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement local-first multi-device sync for OpenJarvis: device identity + approval, CRDT sync, device discovery over LAN, cross-device task scheduling.

**Design spec:** `docs/specs/2026-06-10-track-b-personal-assistant.md`

---

## Architecture

```
packages/track-b/
  src/
    identity/
      device.ts          # DeviceInfo, device keypair generation
      registry.ts      # _devices table CRUD
      pairing.ts       # QR code + token generation
    crdt/
      vector-clock.ts  # VectorClock impl (merge, compare)
      memory-sync.ts   # Memory fragment CRDT
      event-sync.ts    # Event log sync (per-device seq)
      vault-sync.ts    # Vault key CRDT
    network/
      discovery.ts     # mDNS/Bonjour discovery
      noise.ts         # Noise protocol handshake
      channel.ts       # Encrypted sync channel
    routing/
      capabilities.ts  # DeviceCapabilities interface
      router.ts        # Route tasks to best device
      queue.ts         # Offline task queue
    index.ts
  test/
    identity.test.ts
    crdt.test.ts
    network.test.ts
    routing.test.ts
```

---

## Task 1: Device Identity + Registry

**Files:**

- `packages/track-b/src/identity/device.ts`
- `packages/track-b/src/identity/registry.ts`

- [ ] **Step 1: DeviceInfo interface**

```typescript
export interface DeviceInfo {
  deviceId: string; // UUID
  deviceName: string;
  deviceType: "desktop" | "laptop" | "mobile" | "tablet" | "server";
  publicKey: string; // Ed25519 public key (hex)
  approvedAt: number | null;
  approvedBy: string | null;
  lastSeenAt: number;
  vectorClock: Record<string, number>;
}
```

- [ ] **Step 2: Generate Ed25519 keypair**
  - Use `node:crypto` or `tweetnacl` (pure JS)
  - Store private key in OS keychain (keytar or os-specific)

- [ ] **Step 3: Device registry SQLite table**

```sql
CREATE TABLE _devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  public_key TEXT NOT NULL,
  approved_at INTEGER,
  approved_by TEXT REFERENCES _devices(device_id),
  last_seen_at INTEGER,
  vector_clock TEXT NOT NULL DEFAULT '{}'
);
```

- [ ] **Step 4: CRUD operations**
  - `registerDevice(name, type)` — create + persist
  - `getDevice(id)` — read
  - `approveDevice(id, approvedBy)` — set approved
  - `revokeDevice(id)` — set approved_at = null
  - `listDevices()` — all approved devices

- [ ] **Step 5: Tests**
  - Generate keypair, round-trip through registry
  - Approve/revoke flow
  - List approved devices

- [ ] **Step 6: Commit**

```bash
git add packages/track-b/src/identity/
git commit -m "feat(track-b): device identity + registry with Ed25519 keypairs"
```

---

## Task 2: Pairing Flow

**Files:**

- `packages/track-b/src/identity/pairing.ts`

- [ ] **Step 1: Pairing token generation**

```typescript
export function generatePairingToken(): { token: string; expiresAt: number } {
  const token = randomBytes(48).toString("hex");
  return { token, expiresAt: Date.now() + 5 * 60 * 1000 };
}
```

- [ ] **Step 2: QR code payload**

```typescript
export function buildQRPayload(token: string, publicKey: string, ssidHint: string): string {
  return JSON.stringify({ t: token, pk: publicKey.slice(0, 32), ssid: ssidHint });
}
```

- [ ] **Step 3: Verify pairing token**

```typescript
export function verifyPairingToken(token: string, expected: string, expiresAt: number): boolean {
  return token === expected && Date.now() < expiresAt;
}
```

- [ ] **Step 4: Approval message (signed)**

```typescript
export interface ApprovalMessage {
  deviceId: string; // new device's id
  approvedBy: string; // existing device's id
  timestamp: number;
  signature: string; // Ed25519 sig of {deviceId + approvedBy + timestamp}
}
```

- [ ] **Step 5: Tests**
  - Token generation + verification
  - QR payload round-trip
  - Approval message signature verify

- [ ] **Step 6: Commit**

```bash
git add packages/track-b/src/identity/pairing.ts
git commit -m "feat(track-b): pairing flow with QR codes + signed approval"
```

---

## Task 3: Vector Clock + CRDT Foundation

**Files:**

- `packages/track-b/src/crdt/vector-clock.ts`

- [ ] **Step 1: VectorClock interface**

```typescript
export interface VectorClock {
  [deviceId: string]: number;
}
```

- [ ] **Step 2: Merge two vector clocks**

```typescript
export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [device, count] of Object.entries(b)) {
    result[device] = Math.max(result[device] ?? 0, count);
  }
  return result;
}
```

- [ ] **Step 3: Compare vector clocks**

```typescript
export function compare(
  a: VectorClock,
  b: VectorClock,
): "before" | "after" | "concurrent" | "equal" {
  let aGreater = false;
  let bGreater = false;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (av > bv) aGreater = true;
    if (bv > av) bGreater = true;
  }
  if (aGreater && bGreater) return "concurrent";
  if (aGreater) return "after";
  if (bGreater) return "before";
  return "equal";
}
```

- [ ] **Step 4: Tests**
  - Merge two clocks
  - Compare all cases (before/after/concurrent/equal)
  - Increment clock

- [ ] **Step 5: Commit**

```bash
git add packages/track-b/src/crdt/vector-clock.ts
git commit -m "feat(track-b): vector clock merge + compare for CRDT conflict resolution"
```

---

## Task 4: Event Log Sync

**Files:**

- `packages/track-b/src/crdt/event-sync.ts`

- [ ] **Step 1: Per-device seq numbers**

```typescript
export interface SyncedEvent {
  deviceSeq: number; // high 32 bits = device seq, low 32 bits = local seq
  localSeq: number;
  deviceId: string;
  sessionId: string;
  type: string;
  payload: string;
  at: number;
}
```

- [ ] **Step 2: \_sync_state table**

```sql
CREATE TABLE _sync_state (
  device_id TEXT NOT NULL PRIMARY KEY REFERENCES _devices(device_id),
  last_synced_seq INTEGER NOT NULL
);
```

- [ ] **Step 3: Delta sync**

```typescript
export function getDelta(localSeq: number, peerLastSeq: number): SyncedEvent[] {
  // SELECT * FROM events WHERE deviceSeq > ? ORDER BY deviceSeq
}
```

- [ ] **Step 4: Apply delta (no conflicts for append-only)**

```typescript
export function applyDelta(events: SyncedEvent[]): void {
  // INSERT OR IGNORE (dedup by deviceSeq)
}
```

- [ ] **Step 5: Tests**
  - Generate events with per-device seq
  - Delta extraction
  - Apply + dedup

- [ ] **Step 6: Commit**

```bash
git add packages/track-b/src/crdt/event-sync.ts
git commit -m "feat(track-b): event log sync with per-device seq numbers"
```

---

## Task 5: Memory Fragment CRDT

**Files:**

- `packages/track-b/src/crdt/memory-sync.ts`

- [ ] **Step 1: SyncableFragment interface**

```typescript
export interface SyncableFragment {
  fragmentId: string;
  version: number;
  vectorClock: VectorClock;
  text: string;
  createdAt: number;
  tombstone?: number; // soft delete timestamp
}
```

- [ ] **Step 2: Create fragment (commutative)**

```typescript
export function createFragment(text: string, deviceId: string): SyncableFragment {
  return {
    fragmentId: randomUUID(),
    version: 1,
    vectorClock: { [deviceId]: 1 },
    text,
    createdAt: Date.now(),
  };
}
```

- [ ] **Step 3: Update (immutable, version bump)**

```typescript
export function updateFragment(
  fragment: SyncableFragment,
  text: string,
  deviceId: string,
): SyncableFragment {
  const vc = { ...fragment.vectorClock, [deviceId]: (fragment.vectorClock[deviceId] ?? 0) + 1 };
  return { ...fragment, version: fragment.version + 1, vectorClock: vc, text };
}
```

- [ ] **Step 4: Soft delete (tombstone)**

```typescript
export function deleteFragment(fragment: SyncableFragment, deviceId: string): SyncableFragment {
  const vc = { ...fragment.vectorClock, [deviceId]: (fragment.vectorClock[deviceId] ?? 0) + 1 };
  return { ...fragment, version: fragment.version + 1, vectorClock: vc, tombstone: Date.now() };
}
```

- [ ] **Step 5: Conflict resolution (latest vector clock wins)**

```typescript
export function resolveConflict(a: SyncableFragment, b: SyncableFragment): SyncableFragment {
  const cmp = compare(a.vectorClock, b.vectorClock);
  if (cmp === "after" || cmp === "equal") return a;
  if (cmp === "before") return b;
  // Concurrent — keep both as separate versions (or lexicographic deviceId tie-break)
  return JSON.stringify(a.vectorClock) > JSON.stringify(b.vectorClock) ? a : b;
}
```

- [ ] **Step 6: Tests**
  - Create + sync
  - Update version bump
  - Delete tombstone
  - Concurrent conflict resolution

- [ ] **Step 7: Commit**

```bash
git add packages/track-b/src/crdt/memory-sync.ts
git commit -m "feat(track-b): memory fragment CRDT with vector clock conflict resolution"
```

---

## Task 6: Device Discovery (mDNS)

**Files:**

- `packages/track-b/src/network/discovery.ts`

- [ ] **Step 1: mDNS advertisement**

```typescript
export function advertise(
  deviceId: string,
  deviceName: string,
  deviceType: string,
  pkHash: string,
): void {
  // Use bonjour-service or multicast-dns
  // Service: _openhawkins._tcp
  // TXT: pk_hash=<sha256(pk).hex[:16]>, device_type=<type>, device_id=<id>
}
```

- [ ] **Step 2: Scan for peers**

```typescript
export function scanForPeers(timeoutMs: number = 30000): Promise<DiscoveredPeer[]> {
  // Browse _openhawkins._tcp, collect TXT records
}
```

- [ ] **Step 3: DiscoveredPeer interface**

```typescript
export interface DiscoveredPeer {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  pkHash: string;
  host: string;
  port: number;
}
```

- [ ] **Step 4: Tests (mocked)**
  - Advertise + scan round-trip
  - Filter by pkHash match

- [ ] **Step 5: Commit**

```bash
git add packages/track-b/src/network/discovery.ts
git commit -m "feat(track-b): mDNS device discovery with pk_hash advertisement"
```

---

## Task 7: Noise Protocol + Encrypted Channel

**Files:**

- `packages/track-b/src/network/noise.ts`
- `packages/track-b/src/network/channel.ts`

- [ ] **Step 1: Noise XX handshake**

```typescript
export async function noiseHandshake(
  socket: net.Socket,
  localKeypair: Keypair,
  remotePublicKey: Uint8Array,
): Promise<CipherState> {
  // Use @stablelib/noise or noise-c.wasm
  // Pattern: XX (mutual auth with static keys)
}
```

- [ ] **Step 2: Encrypted channel**

```typescript
export class EncryptedChannel {
  constructor(
    private socket: net.Socket,
    private cipher: CipherState,
  ) {}
  async send(msg: SyncMessage): Promise<void> {
    /* encrypt + send */
  }
  async receive(): Promise<SyncMessage> {
    /* recv + decrypt */
  }
}
```

- [ ] **Step 3: Tests**
  - Mock socket handshake
  - Encrypt/decrypt round-trip

- [ ] **Step 4: Commit**

```bash
git add packages/track-b/src/network/
git commit -m "feat(track-b): Noise XX handshake + encrypted sync channel"
```

---

## Task 8: Cross-Device Task Routing

**Files:**

- `packages/track-b/src/routing/capabilities.ts`
- `packages/track-b/src/routing/router.ts`
- `packages/track-b/src/routing/queue.ts`

- [ ] **Step 1: DeviceCapabilities interface**

```typescript
export interface DeviceCapabilities {
  compute: "low" | "medium" | "high";
  battery?: { level: number; charging: boolean };
  storage: "full" | "limited";
  network: "wifi" | "cellular" | "offline";
  tools: string[];
}
```

- [ ] **Step 2: Task routing**

```typescript
export function routeTask(task: Task, devices: DeviceInfo[]): DeviceInfo {
  const candidates = devices.filter(
    (d) => d.online && task.requiredTools.every((t) => d.capabilities.tools.includes(t)),
  );
  candidates.sort((a, b) => computeRank(b) - computeRank(a));
  // Avoid mobile for heavy tasks, avoid battery for long tasks
  if (task.computeEstimate === "high") {
    const nonMobile = candidates.filter((d) => d.deviceType !== "mobile");
    if (nonMobile.length) return nonMobile[0];
  }
  return candidates[0];
}
```

- [ ] **Step 3: Offline queue**

```typescript
export function queueTask(task: Task): void {
  // Store as DomainEvent type "TaskQueued"
  // Forward when suitable device comes online
}
```

- [ ] **Step 4: Tests**
  - Route to highest compute
  - Avoid mobile for heavy tasks
  - Queue + forward

- [ ] **Step 5: Commit**

```bash
git add packages/track-b/src/routing/
git commit -m "feat(track-b): cross-device task routing with capability-aware scheduling"
```

---

## Task 9: Vault Sync + Sync Key Derivation

**Files:**

- `packages/track-b/src/crdt/vault-sync.ts`

- [ ] **Step 1: HKDF sync key derivation**

```typescript
export function deriveSyncMasterKey(passphrase: string): Uint8Array {
  // HKDF-SHA256(passphrase, salt="openjarvis-sync-v1", info="")
}

export function deriveDevicePairKey(
  syncMasterKey: Uint8Array,
  deviceA: string,
  deviceB: string,
): Uint8Array {
  // HKDF-SHA256(syncMasterKey, salt=deviceA + deviceB, info="pair")
}
```

- [ ] **Step 2: Vault CRDT**

```typescript
export interface VaultEntry {
  key: string;
  value: string;
  vectorClock: VectorClock;
  conflictTombstone?: boolean;
}
```

- [ ] **Step 3: Last-write-wins with vector clock**

```typescript
export function mergeVaultEntries(a: VaultEntry, b: VaultEntry): VaultEntry {
  const cmp = compare(a.vectorClock, b.vectorClock);
  if (cmp === "concurrent") {
    // Keep both as conflict tombstones
    return a; // Or merge both
  }
  return cmp === "after" || cmp === "equal" ? a : b;
}
```

- [ ] **Step 4: Tests**
  - Key derivation
  - Vault entry merge
  - Concurrent conflict

- [ ] **Step 5: Commit**

```bash
git add packages/track-b/src/crdt/vault-sync.ts
git commit -m "feat(track-b): vault sync with HKDF key derivation + CRDT merge"
```

---

## Task 10: Integration + Export Barrel

**Files:**

- `packages/track-b/src/index.ts`

- [ ] **Step 1: Export all public APIs**

```typescript
export * from "./identity/device.js";
export * from "./identity/registry.js";
export * from "./identity/pairing.js";
export * from "./crdt/vector-clock.js";
export * from "./crdt/event-sync.js";
export * from "./crdt/memory-sync.js";
export * from "./crdt/vault-sync.js";
export * from "./network/discovery.js";
export * from "./network/noise.js";
export * from "./network/channel.js";
export * from "./routing/capabilities.js";
export * from "./routing/router.js";
export * from "./routing/queue.js";
```

- [ ] **Step 2: Package.json**

```json
{
  "name": "@openjarvis/track-b",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "dependencies": {
    "@openjarvis/core": "*",
    "@openjarvis/state": "*",
    "@openjarvis/memory": "*"
  }
}
```

- [ ] **Step 3: Integration test**

```typescript
// Two devices pair, sync an event, verify on both
```

- [ ] **Step 4: Commit**

```bash
git add packages/track-b/
git commit -m "feat(track-b): export barrel + integration test for full multi-device sync"
```

---

## Task 11: Final Gate

- [ ] **Step 1: Build**
- [ ] **Step 2: Lint**
- [ ] **Step 3: Format**
- [ ] **Step 4: Tests (coverage ≥99%)**
- [ ] **Step 5: Functional tests**
- [ ] **Step 6: Docker gate**

---

## Plan Self-Review

**1. Spec coverage:**

- ✅ B1: Device identity + registry (Task 1)
- ✅ B1: Pairing flow (Task 2)
- ✅ B2: Vector clock (Task 3)
- ✅ B2: Event log sync (Task 4)
- ✅ B2: Memory CRDT (Task 5)
- ✅ B3: mDNS discovery (Task 6)
- ✅ B3: Noise handshake (Task 7)
- ✅ B4: Task routing (Task 8)
- ✅ B5: Vault sync + key derivation (Task 9)

**2. Gate compliance:**

- ✅ TDD: tests for every task
- ✅ Build verification at each step
- ✅ All files follow project conventions

**3. Scope:**

- This is a large plan (11 tasks). Consider splitting into 2–3 PRs:
  - PR 1: Tasks 1–5 (identity + CRDT)
  - PR 2: Tasks 6–8 (network + routing)
  - PR 3: Tasks 9–11 (vault + integration + gate)
