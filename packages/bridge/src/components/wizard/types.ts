import type { ClaimCredentials, BridgeStep, PendingBridge, MessageStatus } from "../../services/bridgeService";
import type { PhaseTiming } from "../../wallet";

export type WizardStep = 1 | 2 | 3 | 4;
export type AztecChoice = "existing" | "new" | null;
export type RecipientChoice = "self" | "other" | null;

export interface BridgeSession {
  /** Which flow phase we're in */
  phase: "l1-pending" | "bridged" | "claiming";
  /** Main claim credentials (available after L1 confirms) */
  credentials?: ClaimCredentials;
  /** Ephemeral claim credentials (dual-bridge only, available after L1 confirms) */
  ephemeralCredentials?: ClaimCredentials | null;
  /** Recipient choice */
  recipientChoice: "self" | "other";
  /** Whether the session used an external wallet (cannot auto-restore) */
  isExternal?: boolean;
  /** The bridge amount (display string, e.g. "100.0") */
  amount?: string;
  /** The recipient address */
  recipient?: string;
  /** Network ID the session was started on */
  networkId: string;
  /** Timestamp for expiry */
  timestamp: number;
  /** Last known tx progress snapshot — for restoring the notification toast */
  txProgressSnapshot?: {
    txId: string;
    label: string;
    phases: PhaseTiming[];
    startTime: number;
    aztecTxHash: string;
  };
  /** L1 bridge tx info — saved right after L1 tx is sent, before receipt */
  l1BridgeParams?: PendingBridge;
}

export type { ClaimCredentials, BridgeStep, MessageStatus, PendingBridge };
