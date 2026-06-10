import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

export function getVersion(): string {
  // Try reading the nearest Git tag first.
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      encoding: "utf-8",
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    return tag.startsWith("v") ? tag.slice(1) : tag;
  } catch {
    // Fall back to the workspace root package.json version.
  }

  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
