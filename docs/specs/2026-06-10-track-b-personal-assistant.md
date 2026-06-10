# Track B: My Brain, Everywhere — Personal Assistant, Local-First, Multi-Device

**Date:** 2026-06-10  
**Status:** Design spec — approved for implementation  
**Author:** Parijat Mukherjee (with OpenCode)  
**Source:** [`docs/reviews/2026-06-09-production-readiness-review.md`](../../reviews/2026-06-09-production-readiness-review.md) §Track B  

---

## 1. One-paragraph thesis

OpenHawkins is **one person's personal assistant**, not a SaaS platform. Every user owns exactly one brain (one Vault, one event store, one VECNA memory graph). That brain lives on the user's devices — PC, laptop, phone — and syncs between them over the local network, never through a cloud server. Each device can run tasks, answer questions, and remember context; the system routes work intelligently based on device capabilities, battery state, and proximity. The model proposes; the runtime enforces; and the user's data never leaves the user's network.

---

## 2. Goals & non-goals

### Goals

1. **One brain, multiple devices.** The same VECNA memory, the same audit chain, the same tool registry — synchronized across all approved devices.
2. **Local-first, always.** All data stays on the user's devices. Sync is device-to-device over the local network (Wi-Fi / LAN). No cloud server, no relay, no third-party storage.
3. **Works offline.** Each device has a full copy of the brain. Network absence is normal, not an error. Changes sync when devices reconnect.
4. **Battery-aware, capability-aware.** The phone handles notifications and quick queries. The PC handles heavy document processing. The laptop handles code. The system routes work to the right device.
5. **User-controlled device approval.** The user explicitly approves each device. A device cannot join the brain without the user's consent on an already-approved device.
6. **End-to-end encrypted sync.** Sync traffic is encrypted with keys derived from the Vault passphrase. The sync network is trustless — even devices on the same LAN cannot read each other's sync data.

### Non-goals

- **No multi-tenancy.** One user, one brain. There is no `tenantId`.
- **No cloud hosting.** No AWS, no hosted backend, no relay server. If the user has only one device, it works fine standalone.
- **No web dashboard.** The dashboard is a local Astro app served by the daemon on each device, accessed via `http://localhost`.
- **No public API.** No external clients connect to OpenHawkins. The only network surface is device-to-device sync.
- **No federation.** Alice's brain does not talk to Bob's brain. This is a single-user system.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    THE USER'S HOME NETWORK                     │
│                                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │   PC (Win)   │   │ Laptop (Mac) │   │  Phone (iOS) │      │
│  │              │   │              │   │              │      │
│  │  ┌────────┐  │   │  ┌────────┐  │   │  ┌────────┐  │      │
│  │  │OpenHawkins│  │   │OpenHawkins│  │   │OpenHawkins│  │      │
│  │  │ Daemon │  │   │  │ Daemon │  │   │  │ Daemon │  │      │
│  │  └────┬───┘  │   │  └────┬───┘  │   │  └────┬───┘  │      │
│  │       │      │   │       │      │   │       │      │      │
│  │  ┌────▼────┐ │   │  ┌────▼────┐ │   │  ┌────▼────┐ │      │
│  │  │SQLite   │ │   │  │SQLite   │ │   │  │SQLite   │ │      │
│  │  │(Brain)  │ │   │  │(Brain)  │ │   │  │(Brain)  │ │      │
│  │  │+Vault   │ │   │  │+Vault   │ │   │  │+Vault   │ │      │
│  │  └─────────┘ │   │  └─────────┘ │   │  └─────────┘ │      │
│  └──────────────┘   └──────────────┘   └──────────────┘      │
│          │                  │                  │              │
│          └──────────────────┼──────────────────┘              │
│                             │                                 │
│                        ┌────▼────┐                            │
│                        │ mDNS    │  ← devices discover each   │
│                        │ discovery│    other on the LAN         │
│                        └────┬────┘                            │
│                             │                                 │
│                        ┌────▼────┐                            │
│                        │ Noise   │  ← encrypted p2p sync       │
│                        │ sync    │    channel                 │
│                        └─────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Track B Subsystems

| # | Subsystem | What it is | Depends on |
|---|-----------|-----------|------------|
| B1 | **Device Identity & Approval** | Pairing flow. Each device gets a `deviceId` + Ed25519 keypair. User approves new devices on existing devices. The Vault becomes a sync group. | — (foundational) |
| B2 | **Local-First Data Architecture** | SQLite per device + CRDT/event-log sync. VECNA memory replicates. Event store syncs. Conflict resolution. | B1 |
| B3 | **Device Discovery & Sync Network** | mDNS/Bonjour on LAN. Encrypted sync (Noise protocol). Master device election. Offline-capable. | B1, B2 |
| B4 | **Cross-Device Task Scheduling** | Route tasks to best device. Battery-aware. Offline queueing. | B1, B2, B3 |
| B5 | **Device-Level Capability Grants** | User grants capabilities per device: "phone can send SMS", "PC can access ~/Documents". | B1 |

---

## 5. B1: Device Identity & Approval

### 5.1 Device identity

Each device has:
- `deviceId`: UUID (generated on first run, persisted in `~/.openhawkins/device.json`)
- `deviceName`: user-editable (e.g., "Parijat's MacBook Pro")
- `deviceType`: `"desktop" | "laptop" | "mobile" | "tablet" | "server"`
- `keypair`: Ed25519 (public key = device identity; private key = stored in OS keychain)
- `approvedAt`: timestamp (null until approved by user)
- `approvedBy`: deviceId of the device that approved this one (null for the first device)

### 5.2 Pairing flow

**Scenario:** User has OpenHawkins running on their PC. They want to add their phone.

```
PC (existing)                           Phone (new)
  │                                        │
  │  User opens "Add Device" on PC         │
  │  → PC generates a temporary pairing    │
  │    token (48-byte random, 5-min TTL)   │
  │  → PC shows a QR code (token + PC's   │
  │    public key + Wi-Fi SSID hint)      │
  │                                        │
  │                                        │  User scans QR code
  │                                        │  → Phone derives sync key
  │                                        │    from Vault passphrase
  │                                        │    + pairing token
  │                                        │
  │  ← Phone announces itself on mDNS     │
  │    with its public key + pairing token │
  │                                        │
  │  PC detects new device, shows prompt: │
  │    "Allow 'Parijat's iPhone' to join?"│
  │  → User taps "Approve"               │
  │                                        │
  │  → PC sends approval message (signed)  │  → Phone receives approval
  │    containing:                         │    → Phone stores its deviceId
  │    - phone's deviceId                │      in the sync group
  │    - PC's deviceId                   │    → Phone starts full sync
  │    - timestamp                       │
  │    - signature (PC's private key)    │
  │                                        │
  │  Both devices now trust each other.  │
```

### 5.3 Vault as sync group

The Vault is re-interpreted:
- **Before:** A single encrypted file on one device.
- **After:** The same encrypted file, but every device has a copy. When a device changes a secret, it syncs the delta to other devices.
- **Conflict resolution:** Last-write-wins with a vector clock per key. If two devices write the same key simultaneously, the lexicographically larger vector clock wins, and the losing write is kept as a conflict tombstone.
- **Sync key:** Derived from the user's Vault passphrase via HKDF-SHA256:
  ```
  syncMasterKey = HKDF-SHA256(passphrase, salt="openhawkins-sync-v1", info="")
  devicePairKey  = HKDF-SHA256(syncMasterKey, salt=deviceId_A + deviceId_B, info="pair")
  syncChannelKey = HKDF-SHA256(syncMasterKey, salt="sync-channel", info="")
  ```
  The `syncChannelKey` encrypts all sync traffic. The `devicePairKey` encrypts one-to-one messages between two specific devices.

### 5.4 Security properties

1. **No cloud, no relay.** An attacker on the internet cannot reach the sync network.
2. **LAN-only discovery.** mDNS announcements include only a hash of the device's public key, not the key itself. The actual key exchange happens over the encrypted sync channel.
3. **User approval required.** A new device on the LAN cannot join without the user explicitly tapping "Approve" on an existing device.
4. **Revocation.** If a device is lost/stolen, the user revokes it from any other device. Revoked devices are excluded from sync; their copy of the Vault becomes stale (they can't read future sync traffic).

---

## 6. B2: Local-First Data Architecture

### 6.1 Per-device SQLite

Every device has a full SQLite database (`~/.openhawkins/brain.db`). The schema is the same across devices.

```sql
-- New table: device registry
CREATE TABLE _devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('desktop','laptop','mobile','tablet','server')),
  public_key TEXT NOT NULL,
  approved_at INTEGER,
  approved_by TEXT REFERENCES _devices(device_id),
  last_seen_at INTEGER,
  vector_clock TEXT NOT NULL DEFAULT '{}'
);

-- Event store gains a device_id column (which device originated this event)
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES _devices(device_id),
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Sync metadata: which events have been synced to which device
CREATE TABLE _sync_state (
  device_id TEXT NOT NULL REFERENCES _devices(device_id),
  last_synced_seq INTEGER NOT NULL,
  PRIMARY KEY (device_id)
);
```

### 6.2 CRDT for VECNA memory

Memory fragments are naturally CRDT-friendly:
- **Create:** A new fragment has a unique `fragmentId` (UUID), a `createdAt` timestamp, and a vector clock. Creating a fragment is commutative — any device can create one.
- **Update:** Fragments are immutable. An "update" creates a new fragment version with the same `fragmentId` and a higher vector clock. The latest version wins.
- **Delete:** Soft delete (tombstone with `deletedAt`). Tombstones are preserved so sync can propagate the deletion.
- **Decay:** Decay is deterministic (a function of time + importance). All devices compute the same decay independently, no sync needed.
- **Embedding:** Vector embeddings are recomputed locally from the fragment text. No need to sync embeddings; sync the text, recompute on arrival.

### 6.3 Event log sync

The event store is append-only. Sync is simple:
1. Device A sends device B: "I have events up to seq 1234"
2. Device B replies: "I have events up to seq 1000; send me 1001-1234"
3. Device A sends the delta
4. Device B appends them to its local store

Since events are immutable and monotonically sequenced, there are no conflicts. The only edge case: two devices generate events simultaneously with overlapping seq numbers. Resolution: each event's `seq` is per-device (e.g., `seq = device_seq << 32 | local_seq`). The global order is deterministic: sort by `(device_seq, local_seq)`.

### 6.4 Audit chain sync

The audit chain is append-only and hash-chained. Syncing it is identical to the event log. Each audit entry carries `device_id` (which device created it). The chain is verified per-device locally; cross-device verification is a future optimization.

---

## 7. B3: Device Discovery & Sync Network

### 7.1 mDNS/Bonjour discovery

Each device advertises itself on the local network via mDNS:
```
Service: _openhawkins._tcp.local
Name:    Parijat's MacBook Pro
TXT:     pk_hash=<sha256(public_key).hex[:16]>  (not the full key)
         device_type=laptop
         device_id=<uuid>
```

Devices scan for peers every 30 seconds. When a new peer is discovered, they attempt to open a Noise protocol handshake on TCP port 45678 (configurable).

### 7.2 Noise protocol handshake

```
Phone                           MacBook
  │                               │
  │  TCP connect to MacBook:45678 │
  │ ─────────────────────────────>│
  │                               │
  │  Noise_XX handshake           │
  │  (both parties authenticate  │
  │   with Ed25519 static keys)   │
  │  → shared secret established  │
  │                               │
  │  Encrypted sync channel       │
  │  (all further traffic is      │
  │   encrypted + authenticated)  │
```

The Noise `XX` pattern provides mutual authentication: both devices prove they own their private keys. If the handshake fails (wrong keys, revoked device), the connection is dropped.

### 7.3 Sync protocol

Once the encrypted channel is open, devices exchange sync messages:

```typescript
interface SyncMessage {
  type: "delta" | "full" | "heartbeat" | "revoke";
  fromDevice: string;
  vectorClock: Record<string, number>;
  payload: SyncPayload;
}

type SyncPayload =
  | { type: "events"; events: DomainEvent[] }
  | { type: "audit"; entries: AuditEntry[] }
  | { type: "vault"; key: string; value: string; vectorClock: Record<string, number> }
  | { type: "memory"; fragments: MemoryFragment[] }
  | { type: "device"; device: DeviceInfo };
```

Sync is pull-based: each device periodically asks peers "what do you have that I don't?" and pulls deltas.

### 7.4 Master device election

One device is elected "master" per sync group. The master is responsible for:
- Assigning `device_seq` numbers to new devices (preventing seq collisions)
- Coordinating Vault key rotation
- Acting as the "source of truth" when devices disagree (rare, since conflicts are resolved by vector clock)

Election: the device with the lowest `deviceId` (UUID comparison) that has been seen in the last 5 minutes. If the master goes offline, a new master is elected automatically.

---

## 8. B4: Cross-Device Task Scheduling

### 8.1 Task routing

The user asks a question on their phone: "Summarize the quarterly report."

```
Phone (where the question was asked)
  │
  │  1. Phone adds the task to its local queue
  │     with routing hints: { preferredDevice: "pc", 
  │                            fallbackDevice: "laptop" }
  │
  │  2. Phone's daemon detects the PC is online
  │     → forwards the task over the sync channel
  │
  │  3. PC receives the task, runs it, generates the answer
  │     → stores the answer in the event log
  │     → syncs the answer back to the phone
  │
  │  4. Phone shows the answer to the user
```

### 8.2 Device capabilities

Each device advertises its capabilities:

```typescript
interface DeviceCapabilities {
  compute: "low" | "medium" | "high";      // CPU/GPU power
  battery?: { level: number; charging: boolean }; // null for plugged-in devices
  storage: "full" | "limited";              // can it store the full brain?
  network: "wifi" | "cellular" | "offline";
  tools: string[];                           // which tools are available on this device
                                             // e.g., ["sms", "camera"] on phone
                                             //       ["shell", "docker"] on PC
}
```

### 8.3 Routing rules

```typescript
function routeTask(task: Task, devices: DeviceInfo[]): DeviceInfo {
  // 1. Filter to devices that are online and have the required tools
  const candidates = devices.filter(d => 
    d.online && 
    task.requiredTools.every(t => d.capabilities.tools.includes(t))
  );
  
  // 2. Prefer the device with the highest compute
  candidates.sort((a, b) => computeRank(b) - computeRank(a));
  
  // 3. Avoid mobile devices if the task is compute-heavy
  if (task.computeEstimate === "high") {
    const nonMobile = candidates.filter(d => d.deviceType !== "mobile");
    if (nonMobile.length > 0) return nonMobile[0];
  }
  
  // 4. Avoid battery-powered devices if the task is long
  if (task.estimatedDuration > 30000) {
    const pluggedIn = candidates.filter(d => !d.capabilities.battery?.charging);
    if (pluggedIn.length > 0) return pluggedIn[0];
  }
  
  return candidates[0];
}
```

### 8.4 Offline queueing

If no suitable device is online, the task is queued locally. The queue is part of the event log (`type: "TaskQueued"`). When a suitable device comes online, the master device (or the device with the queue) forwards the task.

---

## 9. B5: Device-Level Capability Grants

### 9.1 User grants capabilities per device

The user opens the dashboard on their PC and sees:

```
Devices
├── Parijat's MacBook Pro (this device)
│   └── Capabilities: shell, fs:read, fs:write, network, model-call, document:convert
├── Parijat's iPhone
│   └── Capabilities: host:info, sms, camera, model-call
└── Parijat's ThinkPad (work laptop)
    └── Capabilities: shell, fs:read, model-call
        (no fs:write — work machine, don't modify files)
```

The user can toggle capabilities on/off per device. Changes sync to all devices.

### 9.2 Enforcement

When a device attempts to invoke a tool:
1. The tool's `capabilities` are checked against the device's granted capabilities (stored in `_devices` table)
2. If the device lacks a required capability, the tool invocation is rejected with a `ToolCapabilityError`
3. The error is logged in the audit trail: `deviceId` attempted `toolName` without `capabilityName`

### 9.3 New capability: `device:admin`

Only devices with `device:admin` can:
- Approve new devices
- Revoke devices
- Change capability grants
- Rotate Vault keys
- Access the admin dashboard

The first device automatically gets `device:admin`. The user can grant/revoke `device:admin` on other devices.

---

## 10. Backward compatibility

The single-device "self-host" profile is unchanged. All multi-device code is behind a `--sync` flag or auto-detected (if multiple devices are configured). Existing users running OpenHawkins on one machine see no behavior change.

When upgrading from single-device to multi-device:
1. The existing device becomes the "bootstrap" device (automatically gets `device:admin`)
2. The user runs `openhawkins device add` to start pairing
3. The existing SQLite database is treated as the "master" copy; new devices receive a full sync

---

## 11. Security summary

| Threat | Defense |
|--------|---------|
| Attacker on the internet | No cloud surface; LAN-only sync |
| Attacker on the same Wi-Fi | Noise-encrypted sync; mDNS only advertises key hash |
| Stolen device | Revocation from any other device; revoked device can't read future sync |
| Malicious device on LAN | User must explicitly approve; no auto-join |
| Eavesdropping on sync traffic | End-to-end encryption via Noise protocol |
| Device without permission tries tool | Device-level capability grants enforced at runtime |

---

## 12. Acceptance criteria

- [ ] Two devices can pair via QR code and sync events within 30 seconds
- [ ] Adding an event on device A appears on device B after sync
- [ ] Revoking a device stops it from receiving new sync data
- [ ] A task queued on a phone is executed on a PC and the answer appears on the phone
- [ ] A device without `fs:write` capability cannot invoke `fs:write` tools
- [ ] All sync traffic is encrypted (verified via packet capture)
- [ ] The system works offline (single device) with no errors
- [ ] Vault passphrase rotation propagates to all devices

---

## 13. Spec self-review

- **Placeholder scan:** No TBDs. All sections complete.
- **Internal consistency:** The Vault sync model (§5.3) uses the same HKDF derivation as the existing Vault scrypt, ensuring the passphrase is the single source of truth. The event log sync (§6.3) uses per-device seq numbers to avoid collisions, consistent with the existing `seq` auto-increment.
- **Scope check:** This is a focused spec for Track B. It does not cover UI design, specific OS implementations (iOS/Android), or third-party integrations. Those are separate specs.
- **Ambiguity check:** "Local network" is defined as mDNS-discoverable LAN. "Sync" is defined as encrypted delta sync over Noise. All terms are concrete.

---

*Next step: Write implementation plan for B1 → B5, then execute. See [`docs/plans/2026-06-10-track-b-implementation.md`](../../plans/2026-06-10-track-b-implementation.md).*
