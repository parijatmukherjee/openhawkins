import { describe, it, expect } from "vitest";
import { redact } from "../../src/security/redact.js";

describe("redact fuzz", () => {
  it("never throws on random ASCII strings with embedded patterns", () => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;':\",./<>?`~ \t\n\r";
    for (let i = 0; i < 200; i++) {
      let s = "";
      const len = Math.floor(Math.random() * 500) + 1;
      for (let j = 0; j < len; j++) {
        s += chars[Math.floor(Math.random() * chars.length)];
      }
      // pepper with known secret fragments
      const fragments = [
        "sk-",
        "Bearer ",
        "AKIA",
        "AIza",
        "ghp_",
        "github_pat_",
        "sk_live_",
        "xoxb-",
        "eyJ",
        "-----BEGIN RSA PRIVATE KEY-----",
        "@example.com",
      ];
      for (const f of fragments) {
        if (Math.random() < 0.3) {
          const pos = Math.floor(Math.random() * (s.length + 1));
          s = s.slice(0, pos) + f + s.slice(pos);
        }
      }
      expect(() => redact(s)).not.toThrow();
      const result = redact(s);
      expect(typeof result).toBe("string");
    }
  });

  it("never throws on Unicode edge cases", () => {
    const cases = [
      "👍🚀💻🔐🧪🎉",
      "こんにちは世界",
      "你好世界",
      "مرحبا بالعالم",
      "👨‍👩‍👧‍👦",
      "🏳️‍🌈",
      "\u200B\u200C\u200D\uFEFF",
      "a\u200Bb\u200Cc\u200Dd",
      "ℝℕℤℚℂ",
      "𝕳𝖊𝖑𝖑𝖔",
      "\u{1F600}\u{1F60D}\u{1F62D}",
      "العربية\u200F",
      "עברית\u200E",
      // mixed with secret fragments
      "🔑 sk-abc123 🔑",
      "👤 jane.doe@example.com 👤",
      "🚀 Bearer topsecret 🚀",
    ];
    for (const c of cases) {
      expect(() => redact(c)).not.toThrow();
      expect(typeof redact(c)).toBe("string");
    }
  });

  it("never throws on nested and redundant patterns", () => {
    const cases = [
      "sk-sk-sk-abc",
      "Bearer Bearer abc",
      "sk-abc Bearer def ghp_ghi",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----\n-----BEGIN RSA PRIVATE KEY-----\nMIIdef456\n-----END RSA PRIVATE KEY-----",
      "a@b.com c@d.com e@f.com",
      "AKIAaaaaaaaaaaaaaaaa AKIAbbbbbbbbbbbbbbbb",
    ];
    for (const c of cases) {
      expect(() => redact(c)).not.toThrow();
      expect(typeof redact(c)).toBe("string");
    }
  });

  it("never throws on very long strings (10k+ chars)", () => {
    for (let trial = 0; trial < 20; trial++) {
      const chunks = [];
      while (chunks.join("").length < 10000) {
        const len = Math.floor(Math.random() * 200) + 1;
        let chunk = "";
        for (let i = 0; i < len; i++) {
          chunk += String.fromCharCode(32 + Math.floor(Math.random() * 95));
        }
        if (Math.random() < 0.2) {
          const secrets = ["sk-aaaaaaaa", "Bearer xyz", "test@example.com"];
          chunk += secrets[Math.floor(Math.random() * secrets.length)];
        }
        chunks.push(chunk);
      }
      const s = chunks.join("");
      expect(s.length).toBeGreaterThanOrEqual(10000);
      expect(() => redact(s)).not.toThrow();
      const result = redact(s);
      expect(typeof result).toBe("string");
    }
  });

  it("never throws on null bytes and control characters", () => {
    const cases = [
      "\x00",
      "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F",
      "\x1F\x7F\x80\x9F",
      "a\x00b\x01c\x02d",
      "sk-\x00abc",
      "Bearer\x00token",
      "user\x00@example.com",
    ];
    for (const c of cases) {
      expect(() => redact(c)).not.toThrow();
      expect(typeof redact(c)).toBe("string");
    }
  });
});
