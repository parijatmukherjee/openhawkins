import { statfs } from "node:fs/promises";

export type OsName = "windows" | "macos" | "linux";
export type ShellName = "powershell" | "bash";

export interface PlatformInfo {
  os: OsName;
  shell: ShellName;
}

export function detectPlatform(platform: NodeJS.Platform = process.platform): PlatformInfo {
  switch (platform) {
    case "win32":
      return { os: "windows", shell: "powershell" };
    case "darwin":
      return { os: "macos", shell: "bash" };
    default:
      return { os: "linux", shell: "bash" };
  }
}

// statfs is cross-platform on Node >= 19 (incl. Windows). bavail = blocks
// available to an unprivileged user; bsize = fundamental block size.
export async function freeDiskBytes(path: string): Promise<number> {
  const s = await statfs(path);
  return Math.floor(Number(s.bavail) * Number(s.bsize));
}
