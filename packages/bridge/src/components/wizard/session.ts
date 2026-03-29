import type { BridgeSession, BridgePhase } from "./types";
import { SESSION_KEY, SESSION_TTL_MS } from "./constants";

export function saveSession(session: BridgeSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn("[bridge] Failed to save session:", e);
  }
}

function isValidSession(obj: unknown): obj is BridgeSession {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    (s.phase === "l1-pending" || s.phase === "bridged" || s.phase === "claiming") &&
    typeof s.networkId === "string" &&
    typeof s.timestamp === "number" &&
    (s.recipientChoice === "self" || s.recipientChoice === "other")
  );
}

export function loadSession(networkId: string): BridgeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSession(parsed)) return null;
    if (parsed.networkId !== networkId) return null;
    if (Date.now() - parsed.timestamp > SESSION_TTL_MS) return null;
    return parsed;
  } catch (e) {
    console.warn("[bridge] Failed to load session:", e);
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.warn("[bridge] Failed to clear session:", e);
  }
}

/** Convert a persisted session into the appropriate BridgePhase for the reducer. */
export function sessionToPhase(session: BridgeSession): BridgePhase {
  const allCreds = session.allCredentials;

  switch (session.phase) {
    case "l1-pending":
      if (session.l1BridgeParams) {
        return { type: "l1-pending", pendingBridge: session.l1BridgeParams };
      }
      return { type: "idle" };

    case "bridged":
      if (!allCreds || allCreds.length === 0) return { type: "idle" };
      return {
        type: "waiting-l2-sync",
        allCredentials: allCreds,
        messagesReady: allCreds.map(() => false),
        claimKind: session.claimKind,
      };

    case "claiming":
      if (!allCreds || allCreds.length === 0) return { type: "idle" };
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
      return {
        type: "waiting-l2-sync",
        allCredentials: allCreds,
        messagesReady: allCreds.map(() => true),
        claimKind: session.claimKind,
      };

    default: {
      const _exhaustive: never = session.phase;
      console.warn("[bridge] Unknown session phase:", _exhaustive);
      return { type: "idle" };
    }
  }
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
      return { ...base, phase: "claiming", allCredentials: phase.allCredentials, txProgressSnapshot: phase.snapshot, claimKind: phase.claimKind };
    case "idle":
    case "done":
    case "error":
      return null;
    default: {
      const _exhaustive: never = phase;
      console.warn("[bridge] Unknown bridge phase:", _exhaustive);
      return null;
    }
  }
}
