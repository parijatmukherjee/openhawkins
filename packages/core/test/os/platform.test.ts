import { describe, it, expect } from "vitest";
import { detectPlatform, freeDiskBytes } from "../../src/os/platform.js";
import { tmpdir } from "node:os";

describe("detectPlatform", () => {
  it("maps the current process.platform to a known os", () => {
    const p = detectPlatform();
    expect(["windows", "macos", "linux"]).toContain(p.os);
    expect(p.shell).toBeTruthy();
  });

  it("maps win32/darwin/linux deterministically when passed explicitly", () => {
    expect(detectPlatform("win32").os).toBe("windows");
    expect(detectPlatform("win32").shell).toBe("powershell");
    expect(detectPlatform("darwin").os).toBe("macos");
    expect(detectPlatform("linux").os).toBe("linux");
    expect(detectPlatform("linux").shell).toBe("bash");
  });
});

describe("freeDiskBytes", () => {
  it("returns a positive integer number of bytes for the temp dir", async () => {
    const bytes = await freeDiskBytes(tmpdir());
    expect(Number.isInteger(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });
});
