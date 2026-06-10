import type { DeviceInfo } from "./device.js";

export type SyncPayload =
  | { type: "events"; events: unknown[] }
  | { type: "audit"; entries: unknown[] }
  | {
      type: "vault";
      key: string;
      value: string;
      vectorClock: Record<string, number>;
    }
  | { type: "memory"; fragments: unknown[] }
  | { type: "device"; device: DeviceInfo };

export interface SyncMessage {
  type: "delta" | "full" | "heartbeat" | "revoke";
  fromDevice: string;
  vectorClock: Record<string, number>;
  payload: SyncPayload;
}
