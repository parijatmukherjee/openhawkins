# Desktop App — Jarvis Neon Dashboard Design Spec

**Date:** 2026-06-11  
**Status:** Design spec — pending user approval  
**Inspiration:** Marvel's Iron Man Jarvis HUD + Emil Kowalski design engineering  
**Platform:** Electron (cross-platform: macOS, Windows, Linux)

---

## 1. Design Philosophy

### The Iron Man Jarvis Aesthetic

The interface should feel like **Jarvis from the Iron Man films** — a sentient, calm, highly capable AI assistant. Key visual signatures:

- **Deep space blue background** — not pure black, but a rich dark blue (#0a0e1a)
- **Cyan/teal neon glow** — the signature Jarvis blue (#00d4ff, #00b4d8)
- **Holographic glass panels** — translucent with subtle refraction
- **Circular HUD elements** — radar/scope displays, progress rings
- **Voice waveform** — central visualization that pulses when Jarvis speaks
- **Status-driven color coding** — success (cyan), warning (amber), error (red), idle (muted)
- **Smooth, confident animations** — never jittery, always fluid and intentional

### Design Engineering Principles (Emil Kowalski)

- **Unseen details compound** — subtle inner shadows, edge refraction, ambient glow all add up
- **Never animate from scale(0)** — start from scale(0.95) + opacity
- **Custom easing curves** — `cubic-bezier(0.23, 1, 0.32, 1)` for UI interactions
- **UI animations under 300ms** — 150-250ms for most transitions
- **CSS transitions over keyframes** — for interruptible interactions
- **Transform + opacity only** — GPU-accelerated, no layout/paint

---

## 2. Color System

### Primary Palette

| Token            | Hex                      | Usage                                                 |
| ---------------- | ------------------------ | ----------------------------------------------------- |
| `bg-deep`        | `#0a0e1a`                | Main background — deep space blue                     |
| `bg-panel`       | `rgba(10, 20, 40, 0.6)`  | Glass panels — 40% opacity with backdrop blur         |
| `neon-cyan`      | `#00d4ff`                | Primary accent — buttons, active states, Jarvis voice |
| `neon-cyan-dim`  | `rgba(0, 212, 255, 0.3)` | Glow effects, inactive states                         |
| `neon-teal`      | `#00b4d8`                | Secondary accent — gradients, hover states            |
| `text-primary`   | `#e0f2f1`                | Primary text — near-white with slight cyan tint       |
| `text-secondary` | `#607d8b`                | Muted text — timestamps, labels                       |
| `status-success` | `#00e5ff`                | Task complete, agent healthy                          |
| `status-warning` | `#ffab00`                | Attention needed                                      |
| `status-error`   | `#ff5252`                | Agent failed, error state                             |
| `status-idle`    | `#455a64`                | Inactive elements                                     |

### Glow Effects

```css
--glow-cyan: 0 0 20px rgba(0, 212, 255, 0.3), 0 0 40px rgba(0, 212, 255, 0.1);
--glow-cyan-strong: 0 0 30px rgba(0, 212, 255, 0.5), 0 0 60px rgba(0, 212, 255, 0.2);
--panel-border: 1px solid rgba(0, 212, 255, 0.15);
--panel-inner-glow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
```

---

## 3. Typography

### Font Stack

- **Display/Headlines:** `Geist` or `Outfit` — clean, geometric, futuristic
- **Body/UI:** `Geist` — same family for consistency
- **Monospace:** `JetBrains Mono` — for data, timestamps, code snippets

### Scale

| Token        | Size | Weight | Tracking | Usage                 |
| ------------ | ---- | ------ | -------- | --------------------- |
| `display-xl` | 48px | 300    | -0.02em  | Main title ("JARVIS") |
| `display-lg` | 32px | 400    | -0.01em  | Section headers       |
| `heading`    | 20px | 500    | 0        | Card titles           |
| `body`       | 16px | 400    | 0        | General text          |
| `caption`    | 13px | 400    | 0.02em   | Labels, timestamps    |
| `mono`       | 14px | 400    | 0        | Data, metrics         |

---

## 4. Layout Architecture

### Main Dashboard (Post-Onboarding)

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────┐  ┌─────────────────────────────────────────┐   │
│  │ VOICE   │  │           JARVIS HEADER                 │   │
│  │ WAVE    │  │     "Good morning, Parijat"            │   │
│  │ FORM    │  │                                         │   │
│  │ (center)│  └─────────────────────────────────────────┘   │
│  └─────────┘                                              │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ ACTIVE       │  │ TASK BOARD   │  │ AGENT        │   │
│  │ AGENTS       │  │              │  │ STATUS       │   │
│  │ (radar HUD)  │  │ (scrollable) │  │ (grid)       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ EVENT LOG / CONVERSATION HISTORY                      │ │
│  │ (collapsible, bottom panel)                          │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Responsive Breakpoints

- **Desktop (≥1280px):** Full 3-column layout
- **Tablet (768-1279px):** 2-column, voice wave moves to top
- **Mobile (<768px):** Single column, stacked cards

---

## 5. Core Components

### 5.1 Voice Waveform (Central Element)

The iconic Jarvis voice visualization — a central circular waveform that pulses when Jarvis speaks.

**Design:**

- Circular container (200-300px diameter)
- Concentric rings that expand/contract with audio amplitude
- Cyan glow that intensifies when speaking
- Subtle particle effects floating outward during speech
- Idle state: slow, breathing pulse (2s cycle)

**Animation:**

```css
@keyframes voice-idle {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
}
/* Speaking: driven by real-time audio analysis */
/* Transition: scale(0.95) → scale(1) with ease-out */
```

### 5.2 Active Agents HUD (Radar Display)

A circular radar/scope showing active agents as blips.

**Design:**

- Circular container with concentric rings (like a radar scope)
- Agent blips positioned by role (system at center, others orbiting)
- Blip color: cyan (active), amber (busy), red (failed)
- Connecting lines between collaborating agents
- Sweeping radar line animation (subtle, 4s per rotation)

**Animation:**

```css
@keyframes radar-sweep {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
/* Duration: 4s linear infinite */
```

### 5.3 Task Board

Real-time task tracking with neon styling.

**Design:**

- Glass panel with `--panel-border` and `--glow-cyan`
- Tasks as horizontal bars with status indicators
- Status: pending (dim), running (pulsing cyan), completed (bright cyan), failed (red)
- Progress bars with gradient fill
- Agent avatar + task name + duration

**Animation:**

- New task: `scale(0.95) + opacity: 0` → `scale(1) + opacity: 1` (200ms ease-out)
- Completion: brief flash glow (300ms)
- Stagger: 80ms between consecutive task entries

### 5.4 Agent Status Grid

Compact grid showing all registered agents.

**Design:**

- Small cards (80x100px) arranged in a grid
- Agent icon + name + status dot
- Status dot: 8px circle, cyan (healthy), red (down), amber (warning)
- On hover: card lifts with `translateY(-2px)` + glow intensifies
- On click: expands to show agent details

### 5.5 Conversation History

Collapsible bottom panel showing the conversation thread.

**Design:**

- Collapsible via drag handle or click
- User messages: right-aligned, subtle panel
- Jarvis messages: left-aligned, cyan glow border
- System events: centered, monospace, muted color
- Timestamps: `caption` style, `text-secondary`

---

## 6. Onboarding Flow

### First-Time Experience

**Step 1: Welcome Screen**

- Full-screen dark background
- Central "JARVIS" logo with slow pulse animation
- Tagline: "Your Personal AI Assistant"
- Single "Initialize" button with strong cyan glow

**Step 2: Locale Detection**

- Auto-detect system locale
- Show detected language with confirm/change option
- Visual: spinning globe with highlighted region

**Step 3: Voice Calibration**

- "Please speak the following phrase..."
- Real-time waveform visualization during recording
- Confidence meter showing voice recognition quality

**Step 4: Agent Selection**

- "Which agents would you like to enable?"
- Toggle grid of agent cards (Research, System, Vision, etc.)
- Each card shows: icon, description, capability list

**Step 5: Completion**

- "JARVIS is ready."
- Brief animation of all components initializing
- Auto-transition to main dashboard

---

## 7. Animation Specs

### Global Transitions

| Element       | Enter                       | Exit                     | Duration | Easing                         |
| ------------- | --------------------------- | ------------------------ | -------- | ------------------------------ |
| Panel         | scale(0.95), opacity 0      | scale(1), opacity 1      | 200ms    | ease-out                       |
| Card          | translateY(8px), opacity 0  | translateY(0), opacity 1 | 250ms    | ease-out                       |
| Modal         | scale(0.95), opacity 0      | scale(1), opacity 1      | 300ms    | cubic-bezier(0.23, 1, 0.32, 1) |
| Toast         | translateX(100%), opacity 0 | translateX(0), opacity 1 | 400ms    | cubic-bezier(0.23, 1, 0.32, 1) |
| Task item     | scale(0.95), opacity 0      | scale(1), opacity 1      | 200ms    | ease-out                       |
| Status change | —                           | flash glow               | 300ms    | ease                           |

### Micro-Interactions

- **Button press:** `scale(0.97)` on `:active` (100ms)
- **Hover on card:** `translateY(-2px)` + glow intensifies (150ms)
- **Voice activation:** waveform rings expand outward (200ms ease-out)
- **Radar sweep:** 4s linear rotation, subtle opacity pulse
- **Typing indicator:** 3 dots with staggered bounce (600ms loop)

### Loading States

- **Skeleton shimmer:** Linear gradient sweep across placeholder (1.5s loop)
- **Spinner:** Single cyan arc rotating (1s linear infinite)
- **Voice thinking:** Concentric rings pulsing in sequence (2s loop)

---

## 8. Locale & Accessibility

### Locale Support

- Auto-detect system locale on first launch
- UI text localized (English, Spanish, French, German, Japanese, Chinese)
- Date/time formatting: `Intl.DateTimeFormat`
- Number formatting: `Intl.NumberFormat`
- Right-to-left (RTL) support for Arabic/Hebrew

### Accessibility

- **Color contrast:** All text meets WCAG AA (4.5:1 ratio)
- **Motion:** `prefers-reduced-motion` support — disable animations, show static states
- **Keyboard navigation:** Full keyboard control, visible focus rings (cyan)
- **Screen readers:** Proper ARIA labels for all interactive elements
- **High contrast mode:** Pure black/white variant available

---

## 9. Electron Integration

### Window Design

- **Frameless window** — custom title bar with minimize/maximize/close
- **Title bar:** Transparent, buttons styled as small neon dots
- **Background:** `bg-deep` with subtle radial gradient (center slightly lighter)
- **Minimum size:** 1024x768
- **Default size:** 1440x900

### Native Features

- **System tray:** Cyan dot icon, right-click menu
- **Global shortcut:** `Cmd/Ctrl+Shift+J` to show/hide
- **Menu bar:** Minimal — File (Quit), View (Toggle Fullscreen), Help
- **Notifications:** System-native with custom styling (cyan accent)

---

## 10. File Structure

```
packages/desktop/
  src/
    main.ts              # Electron main process
    preload.ts           # Preload script (secure IPC)
    renderer/
      index.html         # Entry HTML
      main.tsx           # React root
      styles/
        globals.css      # Tailwind + custom CSS variables
        animations.css   # Keyframe animations
      components/
        VoiceWaveform.tsx
        AgentRadar.tsx
        TaskBoard.tsx
        AgentStatusGrid.tsx
        ConversationPanel.tsx
        GlassPanel.tsx
        NeonButton.tsx
        StatusDot.tsx
        Onboarding/
          WelcomeScreen.tsx
          LocaleSetup.tsx
          VoiceCalibration.tsx
          AgentSelection.tsx
          CompletionScreen.tsx
      hooks/
        useAudioAnalysis.ts
        useLocale.ts
        useTheme.ts
      contexts/
        LocaleContext.tsx
        ThemeContext.tsx
      types/
        ui.ts
```

---

## 11. Dependencies

### Required

```json
{
  "electron": "^30.0.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "framer-motion": "^11.0.0",
  "tailwindcss": "^3.4.0",
  "@radix-ui/react-dialog": "^1.0.0",
  "@radix-ui/react-tooltip": "^1.0.0",
  "lucide-react": "^0.400.0"
}
```

### Dev Dependencies

```json
{
  "vite": "^5.0.0",
  "@vitejs/plugin-react": "^4.0.0",
  "electron-builder": "^24.0.0",
  "typescript": "^5.4.0",
  "postcss": "^8.4.0",
  "autoprefixer": "^10.4.0"
}
```

---

## 12. Acceptance Criteria

- [ ] App launches as frameless Electron window with dark neon theme
- [ ] Onboarding flow auto-detects locale and guides first-time setup
- [ ] Voice waveform pulses realistically during speech
- [ ] Agent radar shows blips with connecting lines
- [ ] Task board updates in real-time with staggered animations
- [ ] All panels have glassmorphism with inner glow refraction
- [ ] Responsive layout works on 1024x768 to 4K displays
- [ ] `prefers-reduced-motion` disables all animations gracefully
- [ ] Keyboard navigation works throughout the app
- [ ] All code passes: build · lint · format:check · coverage ≥99%

---

_Spec self-review: No TBDs. All sections complete. Internal consistency verified. Scope is focused on desktop app UI only, not backend logic._
