import { describe, expect, test } from "vitest";
import { generateDeviceIdentity, resolveDevice } from "../src/device.js";

describe("generateDeviceIdentity", () => {
  test("returns a device id and ed25519 keypair", () => {
    const identity = generateDeviceIdentity();

    expect(typeof identity.deviceId).toBe("string");
    expect(identity.deviceId.length).toBeGreaterThan(0);

    expect(typeof identity.keypair.publicKey).toBe("string");
    expect(identity.keypair.publicKey.length).toBeGreaterThan(0);

    expect(typeof identity.keypair.privateKey).toBe("string");
    expect(identity.keypair.privateKey.length).toBeGreaterThan(0);
  });

  test("generates unique identities each call", () => {
    const a = generateDeviceIdentity();
    const b = generateDeviceIdentity();

    expect(a.deviceId).not.toBe(b.deviceId);
    expect(a.keypair.publicKey).not.toBe(b.keypair.publicKey);
    expect(a.keypair.privateKey).not.toBe(b.keypair.privateKey);
  });
});

describe("resolveDevice", () => {
  test("returns a DeviceInfo with required fields", () => {
    const info = resolveDevice({
      deviceId: "d-1",
      deviceName: "test-device",
      deviceType: "desktop",
      publicKey: "pk-1",
      vectorClock: { "d-1": 1 },
    });

    expect(info.deviceId).toBe("d-1");
    expect(info.deviceName).toBe("test-device");
    expect(info.deviceType).toBe("desktop");
    expect(info.publicKey).toBe("pk-1");
    expect(info.vectorClock).toEqual({ "d-1": 1 });
  });

  test("allows optional fields", () => {
    const info = resolveDevice({
      deviceId: "d-2",
      deviceName: "mobile-device",
      deviceType: "mobile",
      publicKey: "pk-2",
      approvedAt: Date.now(),
      approvedBy: "admin",
      lastSeenAt: Date.now(),
      vectorClock: {},
    });

    expect(info.approvedAt).toBeDefined();
    expect(info.approvedBy).toBe("admin");
    expect(info.lastSeenAt).toBeDefined();
  });

  test("defaults vectorClock to empty object when omitted", () => {
    const info = resolveDevice({
      deviceId: "d-3",
      deviceName: "tablet-device",
      deviceType: "tablet",
      publicKey: "pk-3",
    });

    expect(info.vectorClock).toEqual({});
  });
});
