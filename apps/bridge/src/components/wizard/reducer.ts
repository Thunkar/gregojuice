import { determineClaimPath } from "./claim-path";
import type { BridgePhase, BridgeAction, ClaimCredentials } from "./types";

export const IDLE: BridgePhase = { type: "idle" } as const;

export function bridgeReducer(state: BridgePhase, action: BridgeAction): BridgePhase {
  switch (action.type) {
    case "BRIDGE_STARTED":
      return { type: "l1-pending", pendingBridge: action.pendingBridge };

    case "L1_CONFIRMED": {
      if (state.type !== "l1-pending" && state.type !== "idle") return state;
      return {
        type: "waiting-l2-sync",
        allCredentials: action.allCredentials,
        messagesReady: action.allCredentials.map(() => false),
        claimKind: action.claimKind,
      };
    }

    case "MESSAGE_READY": {
      if (state.type !== "waiting-l2-sync") return state;
      const newReady = [...state.messagesReady];
      newReady[action.index] = true;
      const allReady = newReady.every(Boolean);
      if (allReady && action.walletReady) {
        const claimPath = determineClaimPath(
          state.allCredentials,
          action.feeJuiceBalance,
          state.claimKind,
        );
        if (claimPath) {
          return {
            type: "ready-to-claim",
            allCredentials: state.allCredentials,
            claimPath,
          };
        }
      }
      return { ...state, messagesReady: newReady };
    }

    case "WALLET_READY": {
      if (state.type !== "waiting-l2-sync") return state;
      if (!state.messagesReady.every(Boolean)) return state;
      const claimPath = determineClaimPath(
        state.allCredentials,
        action.feeJuiceBalance,
        state.claimKind,
      );
      if (!claimPath) return state;
      return {
        type: "ready-to-claim",
        allCredentials: state.allCredentials,
        claimPath,
      };
    }

    case "WALLET_NOT_READY": {
      if (state.type !== "ready-to-claim") return state;
      return {
        type: "waiting-l2-sync",
        allCredentials: state.allCredentials,
        messagesReady: state.allCredentials.map(() => true),
        claimKind: state.claimPath.kind,
      };
    }

    case "CLAIM_STARTED": {
      if (state.type !== "ready-to-claim") return state;
      return {
        type: "claiming",
        allCredentials: state.allCredentials,
        claimPath: state.claimPath,
      };
    }

    case "TX_SENT": {
      if (state.type !== "claiming") return state;
      return {
        type: "claim-sent",
        allCredentials: state.allCredentials,
        txHash: action.txHash,
        snapshot: action.snapshot,
        claimKind: state.claimPath.kind,
      };
    }

    case "CLAIM_DONE":
      if (state.type !== "claiming" && state.type !== "claim-sent") return state;
      return { type: "done" };

    case "ERROR": {
      // Preserve credentials and claimKind for retry if we were in a claim-related state
      if (state.type === "ready-to-claim" || state.type === "claiming") {
        return {
          type: "error",
          message: action.message,
          allCredentials: state.allCredentials,
          claimKind: state.claimPath.kind,
        };
      }
      if (state.type === "claim-sent") {
        return {
          type: "error",
          message: action.message,
          allCredentials: state.allCredentials,
        };
      }
      if (state.type === "waiting-l2-sync") {
        return {
          type: "error",
          message: action.message,
          allCredentials: state.allCredentials,
          claimKind: state.claimKind,
        };
      }
      return { type: "error", message: action.message };
    }

    case "RETRY_CLAIM": {
      if (state.type !== "error" || !("allCredentials" in state)) return state;
      const claimPath = determineClaimPath(
        state.allCredentials as ClaimCredentials[],
        action.feeJuiceBalance,
        state.claimKind,
      );
      if (claimPath) {
        return {
          type: "ready-to-claim",
          allCredentials: state.allCredentials as ClaimCredentials[],
          claimPath,
        };
      }
      return state;
    }

    case "RESET":
      return IDLE;

    default:
      return state;
  }
}
