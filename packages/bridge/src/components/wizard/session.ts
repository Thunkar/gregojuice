import type { BridgeSession, BridgePhase } from "./types";
import { SESSION_KEY, SESSION_TTL_MS } from "./constants";

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

  const allCreds = session.allCredentials;
  if (!allCreds || allCreds.length === 0) return { type: "idle" };

  if (session.phase === "bridged") {
    return {
      type: "waiting-l2-sync",
      allCredentials: allCreds,
      messagesReady: allCreds.map(() => false),
      claimKind: session.claimKind,
    };
  }

  if (session.phase === "claiming") {
    // Tx was sent and is mining — resume polling
    if (session.txProgressSnapshot?.aztecTxHash) {
      return {
        type: "claim-sent",
        allCredentials: allCreds,
        txHash: session.txProgressSnapshot.aztecTxHash,
        snapshot: session.txProgressSnapshot,
      };
    }
    // Tx not yet sent — restore to waiting-l2-sync with messages pre-marked ready
    // The claimKind from the session tells us which path to use once wallet balance is known
    return {
      type: "waiting-l2-sync",
      allCredentials: allCreds,
      messagesReady: allCreds.map(() => true),
      claimKind: session.claimKind,
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
    recipients: Array<{ address: string; amount: string }>;
    networkId: string;
  },
): BridgeSession | null {
  const base = {
    recipientChoice: ctx.recipientChoice,
    isExternal: ctx.isExternal,
    recipients: ctx.recipients,
    networkId: ctx.networkId,
    timestamp: Date.now(),
  };

  switch (phase.type) {
    case "l1-pending":
      return { ...base, phase: "l1-pending", l1BridgeParams: phase.pendingBridge };
    case "waiting-l2-sync":
      return { ...base, phase: "bridged", allCredentials: phase.allCredentials, claimKind: phase.claimKind };
    case "ready-to-claim":
    case "claiming":
      return { ...base, phase: "claiming", allCredentials: phase.allCredentials, claimKind: phase.claimPath.kind };
    case "claim-sent":
      return { ...base, phase: "claiming", allCredentials: phase.allCredentials, txProgressSnapshot: phase.snapshot };
    default:
      return null;
  }
}
