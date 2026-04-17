import type { BridgeStep } from "./types";

// ── localStorage keys ────────────────────────────────────────────────
export const SESSION_KEY = "gregojuice_bridge_session";
export const NETWORK_STORAGE_KEY = "gregojuice_network";
export const BRIDGE_CONTRACT_STORAGE_KEY = "gregojuice_bridge_contract_v2";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Bridge constants ─────────────────────────────────────────────────
/** Fee Juice reserved for the embedded account to pay L2 claim tx gas (in FJ, not wei) */
export const EPHEMERAL_CLAIM_GAS_FJ = "100";
/** Maximum number of recipients per bridge transaction */
export const MAX_RECIPIENTS = 3;
/** Polling interval for L1→L2 message readiness (ms) */
export const MESSAGE_POLL_INTERVAL_MS = 5000;

// ── Phase timeline colors ────────────────────────────────────────────
export const PHASE_COLOR_MINING = "#4caf50";

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
