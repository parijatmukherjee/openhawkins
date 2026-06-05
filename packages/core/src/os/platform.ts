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
