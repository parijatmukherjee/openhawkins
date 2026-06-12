import { createContext, useContext } from "react";
import type { NexusBridge } from "../lib/nexus-bridge";

const NexusContext = createContext<NexusBridge | null>(null);

export const NexusProvider = NexusContext.Provider;

export function useNexus(): NexusBridge {
  const ctx = useContext(NexusContext);
  if (!ctx) throw new Error("useNexus must be used within a NexusProvider");
  return ctx;
}
