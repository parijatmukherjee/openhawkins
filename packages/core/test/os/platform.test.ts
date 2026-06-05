import { describe, it, expect } from "vitest";
import { detectPlatform } from "../../src/os/platform.js";

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
