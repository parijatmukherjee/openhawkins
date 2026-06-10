import { generateKeyPairSync, randomUUID } from "node:crypto";

export interface DeviceIdentity {
  deviceId: string;
  keypair: { publicKey: string; privateKey: string };
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: "desktop" | "laptop" | "mobile" | "tablet" | "server";
  publicKey: string;
  approvedAt?: number;
  approvedBy?: string;
  lastSeenAt?: number;
  vectorClock: Record<string, number>;
}

export function generateDeviceIdentity(): DeviceIdentity {
  const keypair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  return {
    deviceId: randomUUID(),
    keypair: {
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
    },
  };
}

export function resolveDevice(
  partial: Omit<DeviceInfo, "vectorClock"> & { vectorClock?: Record<string, number> },
): DeviceInfo {
  return {
    ...partial,
    vectorClock: partial.vectorClock ?? {},
  };
}
