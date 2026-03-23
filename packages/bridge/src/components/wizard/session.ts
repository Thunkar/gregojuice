import type { BridgeSession, BridgePhase, RecipientChoice } from "./types";
import { SESSION_KEY, SESSION_TTL_MS } from "./constants";
import { determineClaimPath } from "./claim-path";

export function saveSession(session: BridgeSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadSession(networkId: string): BridgeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as BridgeSession;
    if (session.networkId !== networkId) return null;
    if (Date.now() - session.timestamp > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Convert a persisted session into the appropriate BridgePhase for the reducer. */
export function sessionToPhase(session: BridgeSession): BridgePhase {
  if (session.phase === "l1-pending" && session.l1BridgeParams) {
    return { type: "l1-pending", pendingBridge: session.l1BridgeParams };
  }

  if (session.phase === "bridged" && session.credentials) {
    return {
      type: "waiting-l2-sync",
      credentials: session.credentials,
      ephemeral: session.ephemeralCredentials ?? null,
      messageReady: false,
      ephMessageReady: !session.ephemeralCredentials,
    };
  }

  if (session.phase === "claiming" && session.credentials) {
    // Tx was sent and is mining — resume polling the node directly
    if (session.txProgressSnapshot?.aztecTxHash) {
      return {
        type: "claim-sent",
        credentials: session.credentials,
        txHash: session.txProgressSnapshot.aztecTxHash,
        snapshot: session.txProgressSnapshot,
      };
    }
    // Tx was never sent (refresh during simulating/proving) — try to
    // re-derive the claim path so we can re-trigger the claim.
    const claimPath = determineClaimPath(
      session.recipientChoice,
      session.ephemeralCredentials ?? null,
      session.credentials,
      null, // feeJuiceBalance unknown on restore — will be re-evaluated
    );
    if (claimPath) {
      return {
        type: "ready-to-claim",
        credentials: session.credentials,
        ephemeral: session.ephemeralCredentials ?? null,
        claimPath,
      };
    }
    // Can't determine path yet (third-party claim, balance unknown).
    // Fall back to waiting-l2-sync with messages pre-marked ready so that
    // when WALLET_READY fires with the balance, the reducer can transition.
    return {
      type: "waiting-l2-sync",
      credentials: session.credentials,
      ephemeral: session.ephemeralCredentials ?? null,
      messageReady: true,
      ephMessageReady: true,
    };
  }

  return { type: "idle" };
}

/** Convert current BridgePhase into a persistable session. */
export function phaseToSession(
  phase: BridgePhase,
  ctx: {
    recipientChoice: "self" | "other";
    isExternal: boolean;
    amount?: string;
    recipient?: string;
    networkId: string;
  },
): BridgeSession | null {
  const base = {
    recipientChoice: ctx.recipientChoice,
    isExternal: ctx.isExternal,
    amount: ctx.amount,
    recipient: ctx.recipient,
    networkId: ctx.networkId,
    timestamp: Date.now(),
  };

  switch (phase.type) {
    case "l1-pending":
      return { ...base, phase: "l1-pending", l1BridgeParams: phase.pendingBridge };
    case "waiting-l2-sync":
      return { ...base, phase: "bridged", credentials: phase.credentials, ephemeralCredentials: phase.ephemeral };
    case "ready-to-claim":
      return { ...base, phase: "claiming", credentials: phase.credentials, ephemeralCredentials: phase.ephemeral };
    case "claiming":
      return { ...base, phase: "claiming", credentials: phase.credentials, ephemeralCredentials: phase.ephemeral };
    case "claim-sent":
      return { ...base, phase: "claiming", credentials: phase.credentials, txProgressSnapshot: phase.snapshot };
    default:
      return null;
  }
}
