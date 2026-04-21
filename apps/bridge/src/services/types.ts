import type { Hex } from "viem";

export interface L1Addresses {
  feeJuicePortal: Hex;
  feeJuice: Hex;
  feeAssetHandler: Hex | null;
}

export interface ClaimCredentials {
  claimSecret: Hex;
  claimSecretHash: Hex;
  messageHash: Hex;
  messageLeafIndex: string;
  claimAmount: string;
  recipient: string;
}

export type BridgeStep =
  | "idle"
  | "fetching-addresses"
  | "minting"
  | "approving"
  | "bridging"
  | "waiting-confirmation"
  | "waiting-l2-sync"
  | "claimable"
  | "done"
  | "error";

/**
 * Info about an L1 bridge tx that's been sent but not yet confirmed.
 * Save this to recover if the user refreshes mid-flight.
 */
export interface PendingBridge {
  l1TxHash: string;
  secrets: Array<{ secret: string; secretHash: string }>;
  recipients: string[];
  amounts: string[];
}

export type MessageStatus = "pending" | "ready" | "error";
