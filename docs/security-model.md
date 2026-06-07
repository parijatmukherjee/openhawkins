# OpenHawkins Security Model — answering the openclaw-hawkins audit

This document maps the security findings raised against the **openclaw-hawkins
plugin** (an ASI / agentic-security audit) to how **OpenHawkins** overcomes each
one. It is the operational companion to spec
[§5.5 "Security, Trust & Safety model"](specs/2026-06-05-openhawkins-design.md)
and the problems table (P13–P22) in the umbrella design.

## The governing difference

Every recommendation in the openclaw-hawkins audit is a thing **the operator must
remember to configure**: _set `VECNA_AUTH_TOKEN`_, _scope your Linear key_,
_allowlist the tools_, _don't put secrets in messages_, _run setup carefully_.

OpenHawkins's thesis is the inverse: **safety is a runtime default and an enforced
invariant, sitting below the model — not operator discipline, not a config flag the
model or a misconfiguration can bypass.** The same principle as the Grounding
engine (Eleven): the model proposes, the runtime enforces.

Legend: 🟢 **built** (merged code) · 🟡 **designed, scheduled** (spec'd, in the build order).

---

## ASI06 — Memory & Context Poisoning (Medium)

**openclaw-hawkins:** VECNA is an HTTP service on `127.0.0.1:8765`. If
`VECNA_AUTH_TOKEN` is unset, _any local process that can reach the port can
connect and `evolve` fragments_ that are later recalled into agent context.

**How OpenHawkins overcomes it — remove the attack surface, don't patch it:**

- 🟡 **VECNA is reborn as a runtime-owned, in-process library over embedded SQLite
  — no listening port by default** (spec §4, P5/P11). There is no socket for a
  "reachable local process" to connect to; the class of attack disappears rather
  than being mitigated by a token the operator might forget.
- 🟢 **Write/evolve is capability-gated by _The Lab_.** Only an agent granted a
  `memory:write` capability may mutate fragments; default-deny. The capability
  engine (`grantSatisfies` + the `ToolRegistry` gate) is **already merged** (S1.2).
- 🟡 **The Gate (taint/provenance):** fragments derived from untrusted/external
  content are tagged; recall down-ranks or quarantines tainted memory so poison
  cannot silently become "trusted" memory (spec §5.5.3).
- 🟡 **Eleven (grounding):** even a wrong fragment is only a _hint_ —
  grounding-required tasks must verify via tools, so poisoned memory cannot
  directly produce a fabricated action.
- 🟡 **Murray (tamper-evident audit):** every write/evolve is hash-chained, so a
  poisoned fragment is attributable and revertible (spec §5.5.5).
- 🟡 If networked memory is ever enabled (multi-host), bearer/mTLS + loopback
  binding is **mandatory, not optional**.

_Owners: capability gate **S1.2 (done)**; memory subsystem **S2**; taint/audit **S1.6**._

---

## ASI03 — Identity & Privilege Abuse (Medium)

**openclaw-hawkins:** the Linear integration acts with whatever authority the API
key has; a personal key inherits the issuing user's **full workspace scope**.

**How OpenHawkins overcomes it — delete the over-scoped dependency:**

- 🟡 **Linear is dropped entirely** (decision §11.5) and replaced by an in-repo
  ticket system, **"The Board"**, backed by local SQLite. There is **no
  third-party key with broad scope at all** — the blast radius shrinks from "your
  entire Linear workspace" to "a local table."
- 🟢/🟡 **RBAC + least privilege (spec §5.5.2):** the Nexus and each Tendril get
  scoped capability grants; no agent inherits "the user's full scope." The
  capability model is **built (S1.2)**; per-agent role wiring lands with the
  orchestrator (S3).
- 🟡 Any _optional_ external exporter added later resolves its token through **The
  Cabin** (scoped, encrypted) and declares the minimum capability — OAuth/scoped
  tokens enforced by the capability model, not by convention.

_Owners: capability model **S1.2 (done)**; The Board **S3/S5**; RBAC wiring **S3**._

---

## ASI02 — Tool Misuse & Exploitation (Low) — **already solved in code**

**openclaw-hawkins:** 12 mutation tools (`vines_*`, `vecna_*`) are exposed to any
granted agent; safety relies on operators to _allowlist tools per agent_ and
_manually review_ sensitive calls.

**How OpenHawkins overcomes it — "allowlist per agent" becomes a runtime default.**
This is exactly what shipped in S1.2:

```ts
// The Lab — default-deny, enforced by the ToolRegistry on EVERY call
const missing = tool.capabilities.filter((c) => !grantSatisfies(grant, c));
if (missing.length > 0) return fail(call, `capability denied: ${...}`);
```

- 🟢 **Every tool declares the capabilities it needs; the registry default-denies**
  any call the calling agent isn't granted. No operator allowlist required.
- 🟢 **Typed tool I/O:** args _and_ results are Zod-validated in both directions;
  malformed/abusive inputs are rejected at the boundary and the registry **never
  throws** (a throwing arg schema is caught, not propagated).
- 🟢 **Confused-deputy guard:** a tool call whose execution context
  (`ctx.agentId`) doesn't match the presented grant is failed fast — an agent
  can't run tools under another agent's authority.
- 🟡 **Hopper approval gates (spec §5.5.6):** mutating/high-risk tools are
  risk-classified and require runtime-mediated human approval (a Telegram/Discord
  button or dashboard prompt) — built-in, not "where the runtime supports it."
- 🟡 **Murray:** every tool call (args redacted) is auditable in the dashboard;
  review is a view, not log-scraping.

_Owners: capability gate + typed I/O + confused-deputy guard **S1.2 (done)**;
approvals **S1.6**; audit/dashboard **S1.6 + S4/S5**._

---

## ASI07 — Insecure Inter-Agent Communication (Low)

**openclaw-hawkins:** secrets placed in tool arguments, memory, or dispatch
messages are forwarded into the receiving agent's prompt and on to its model
provider.

**How OpenHawkins overcomes it — keep secrets out of the data plane entirely:**

- 🟡 **The Cabin (spec §5.5.1):** secrets live in the OS keychain / an encrypted
  vault and resolve **at the point of use** — never in config, messages, or
  memory. The config schema **refuses** secret values; the runtime **redacts
  secret-shaped values** from events, audit, and assembled prompts.
- 🟡 **In-process typed dispatch (P2):** dispatch is a typed message bus, **not
  subprocess CLI args / stdout** — so nothing leaks via `argv`, shell history, or
  a stdout buffer (the openclaw-hawkins dispatch shells out to
  `openclaw agent … --message`, putting payloads on a command line).
- 🟡 **The Gate:** cross-agent content carries provenance; tainted/secret material
  can be scrubbed before it reaches a provider. `model-call` is itself a
  capability, so what context is assembled for a provider is gated.

_Owners: `FileVault` interface **S1.3**; redaction **S1.6**; in-process dispatch **S3**._

---

## ASI05 — Unexpected Code Execution (Info)

**openclaw-hawkins:** `openclaw hawkins setup` provisions agent workspaces **and
MariaDB schemas** on the host.

**How OpenHawkins overcomes it — shrink and contain the footprint:**

- 🟡 **Zero external DB by default** (embedded SQLite, spec §6): setup never
  provisions a MariaDB server/schema/user; it creates one **local data dir** under
  the OS-appropriate path. Smaller, deletable, reversible.
- 🟡 **Mr. Clarke (setup wizard)** shows exactly what it will do and asks before
  making changes; idempotent.
- 🟢 **Single self-contained binary** (Bun `--compile`, verified in S1.0): no
  global npm/agent-runtime mutation; the artifact is self-contained.
- 🟡 Post-install, **sandboxed capability-gated Tendrils (The Lab)** can't execute
  host changes outside their grants.

_Owners: single binary **S1.0 (done)**; SQLite-default + wizard **S2/S6**;
sandbox hardening **S6**._

---

## Status at a glance

| Finding                 | Severity | Primary defense                                           | Status                         |
| ----------------------- | -------- | --------------------------------------------------------- | ------------------------------ |
| ASI06 Memory poisoning  | Medium   | No memory port + capability-gated writes + taint + audit  | 🟢 gate done · 🟡 rest S2/S1.6 |
| ASI03 Privilege abuse   | Medium   | Drop Linear → local "The Board" + RBAC                    | 🟢 caps done · 🟡 S3           |
| ASI02 Tool misuse       | Low      | The Lab default-deny + typed I/O + confused-deputy guard  | 🟢 **done (S1.2)**             |
| ASI07 Inter-agent comms | Low      | The Cabin vault + redaction + in-process dispatch         | 🟡 S1.3/S1.6/S3                |
| ASI05 Code execution    | Info     | SQLite default, single binary, reviewable wizard, sandbox | 🟢 binary done · 🟡 S2/S6      |

The first and most central defense — **The Lab capability gate + typed tool I/O**,
which directly kills ASI02 and underpins ASI06/ASI03 — is **already merged code**
(S1.2). The remainder is scheduled across S1.3, S1.6, S2, S3, S4–S6 per the build
order in the umbrella design.
