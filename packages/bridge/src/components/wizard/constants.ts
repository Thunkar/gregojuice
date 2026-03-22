import type { BridgeStep } from "./types";

export const SESSION_KEY = "gregojuice_bridge_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const BRIDGE_STEP_LABELS: Record<BridgeStep, string> = {
  idle: "",
  "fetching-addresses": "Fetching addresses...",
  minting: "Minting tokens...",
  approving: "Approving...",
  bridging: "Depositing...",
  "waiting-confirmation": "Waiting for L1 confirmation...",
  "waiting-l2-sync": "Waiting for L2 sync...",
  claimable: "Ready to claim!",
  done: "Bridge complete!",
  error: "Error",
};
