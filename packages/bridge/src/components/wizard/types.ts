import type { ClaimCredentials, BridgeStep, PendingBridge, MessageStatus } from "../../services";
import type { PhaseTiming } from "@gregojuice/embedded-wallet";

export interface Recipient {
  address: string;
  amount: string;
}

export type WizardStep = 1 | 2 | 3 | 4;
export type AztecChoice = "existing" | "new" | null;
export type RecipientChoice = "self" | "other" | null;
/**
 * Claim strategy for the L2 side:
 * - "self":      external wallet bridges to itself — single credential, wallet pays gas
 * - "bootstrap": embedded wallet has no gas — first credential is the gas payer
 * - "batch":     wallet already funded — all credentials claimed normally
 */
export type ClaimKind = "self" | "bootstrap" | "batch";

// ── Claim path (pure, computed by reducer) ────────────────────────────

export type ClaimPath =
  | { kind: "bootstrap"; bootstrapClaim: ClaimCredentials; otherClaims: ClaimCredentials[] }
  | { kind: "batch"; claims: ClaimCredentials[] };

// ── Tx progress snapshot (for crash recovery) ─────────────────────────

export interface TxProgressSnapshot {
  txId: string;
  label: string;
  phases: PhaseTiming[];
  startTime: number;
  aztecTxHash: string;
}

// ── Bridge state machine ──────────────────────────────────────────────

/**
 * allCredentials[0] is always the ephemeral (fee payer) credential when length > 1.
 * For self-claim (length === 1), allCredentials[0] is the self-claim credential.
 * messagesReady[i] tracks whether each credential's L1→L2 message is synced.
 */
export type BridgePhase =
  | { type: "idle" }
  | { type: "l1-pending"; pendingBridge: PendingBridge }
  | { type: "waiting-l2-sync"; allCredentials: ClaimCredentials[]; messagesReady: boolean[]; claimKind?: ClaimKind }
  | { type: "ready-to-claim"; allCredentials: ClaimCredentials[]; claimPath: ClaimPath }
  | { type: "claiming"; allCredentials: ClaimCredentials[]; claimPath: ClaimPath }
  | { type: "claim-sent"; allCredentials: ClaimCredentials[]; txHash: string; snapshot: TxProgressSnapshot; claimKind?: ClaimKind }
  | { type: "done" }
  | { type: "error"; message: string; allCredentials?: ClaimCredentials[]; claimKind?: ClaimKind };

export type BridgeAction =
  | { type: "BRIDGE_STARTED"; pendingBridge: PendingBridge }
  | { type: "L1_CONFIRMED"; allCredentials: ClaimCredentials[]; claimKind?: ClaimKind }
  | { type: "MESSAGE_READY"; index: number; feeJuiceBalance: string | null; walletReady: boolean }
  | { type: "WALLET_READY"; feeJuiceBalance: string | null }
  | { type: "WALLET_NOT_READY" }
  | { type: "CLAIM_STARTED" }
  | { type: "TX_SENT"; txHash: string; snapshot: TxProgressSnapshot }
  | { type: "CLAIM_DONE" }
  | { type: "ERROR"; message: string }
  | { type: "RETRY_CLAIM"; feeJuiceBalance: string | null }
  | { type: "RESET" };

// ── Session (localStorage) ────────────────────────────────────────────

export interface BridgeSession {
  phase: "l1-pending" | "bridged" | "claiming";
  allCredentials?: ClaimCredentials[];
  /** Which claim strategy was used: "bootstrap" (first cred pays gas) or "batch" (wallet funded) */
  claimKind?: ClaimKind;
  recipientChoice: "self" | "other";
  isExternal?: boolean;
  /** All recipients with their amounts (address + amount pairs) */
  recipients?: Array<{ address: string; amount: string }>;
  networkId: string;
  timestamp: number;
  txProgressSnapshot?: TxProgressSnapshot;
  l1BridgeParams?: PendingBridge;
}

export type { ClaimCredentials, BridgeStep, MessageStatus, PendingBridge };
export type { AztecWalletStatus } from "../../contexts/AztecWalletContext";
