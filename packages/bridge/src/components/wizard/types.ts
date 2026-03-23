import type { ClaimCredentials, BridgeStep, PendingBridge, MessageStatus } from "../../services/bridgeService";
import type { PhaseTiming } from "../../wallet";

export type WizardStep = 1 | 2 | 3 | 4;
export type AztecChoice = "existing" | "new" | null;
export type RecipientChoice = "self" | "other" | null;

// ── Claim path (pure, computed by reducer) ────────────────────────────

export type ClaimPath =
  | { kind: "self" }
  | { kind: "both"; ephemeral: ClaimCredentials; recipient: string }
  | { kind: "for-recipient"; recipient: string };

// ── Tx progress snapshot (for crash recovery) ─────────────────────────

export interface TxProgressSnapshot {
  txId: string;
  label: string;
  phases: PhaseTiming[];
  startTime: number;
  aztecTxHash: string;
}

// ── Bridge state machine ──────────────────────────────────────────────

export type BridgePhase =
  | { type: "idle" }
  | { type: "l1-pending"; pendingBridge: PendingBridge }
  | { type: "waiting-l2-sync"; credentials: ClaimCredentials; ephemeral: ClaimCredentials | null; messageReady: boolean; ephMessageReady: boolean }
  | { type: "ready-to-claim"; credentials: ClaimCredentials; ephemeral: ClaimCredentials | null; claimPath: ClaimPath }
  | { type: "claiming"; credentials: ClaimCredentials; ephemeral: ClaimCredentials | null; claimPath: ClaimPath }
  | { type: "claim-sent"; credentials: ClaimCredentials; txHash: string; snapshot: TxProgressSnapshot }
  | { type: "done" }
  | { type: "error"; message: string };

export type BridgeAction =
  | { type: "BRIDGE_STARTED"; pendingBridge: PendingBridge }
  | { type: "L1_CONFIRMED"; credentials: ClaimCredentials; ephemeral: ClaimCredentials | null }
  | { type: "MESSAGE_READY"; which: "main" | "ephemeral"; recipientChoice: RecipientChoice; feeJuiceBalance: string | null; walletReady: boolean }
  | { type: "WALLET_READY"; recipientChoice: RecipientChoice; feeJuiceBalance: string | null }
  | { type: "WALLET_NOT_READY" }
  | { type: "CLAIM_STARTED" }
  | { type: "TX_SENT"; txHash: string; snapshot: TxProgressSnapshot }
  | { type: "CLAIM_DONE" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

// ── Session (localStorage) ────────────────────────────────────────────

export interface BridgeSession {
  phase: "l1-pending" | "bridged" | "claiming";
  credentials?: ClaimCredentials;
  ephemeralCredentials?: ClaimCredentials | null;
  recipientChoice: "self" | "other";
  isExternal?: boolean;
  amount?: string;
  recipient?: string;
  networkId: string;
  timestamp: number;
  txProgressSnapshot?: TxProgressSnapshot;
  l1BridgeParams?: PendingBridge;
}

export type { ClaimCredentials, BridgeStep, MessageStatus, PendingBridge };
