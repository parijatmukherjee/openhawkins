/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-deep": "#0a0e1a",
        "bg-panel": "rgba(10, 20, 40, 0.6)",
        "neon-cyan": "#00d4ff",
        "neon-teal": "#00b4d8",
        "text-primary": "#e0f2f1",
        "text-secondary": "#607d8b",
        "status-success": "#00e5ff",
        "status-warning": "#ffab00",
        "status-error": "#ff5252",
        "status-idle": "#455a64",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "voice-idle": "voice-idle 2s ease-in-out infinite",
        "radar-sweep": "radar-sweep 4s linear infinite",
        shimmer: "shimmer 1.5s linear infinite",
      },
      keyframes: {
        "voice-idle": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.05)", opacity: "0.8" },
        },
        "radar-sweep": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
