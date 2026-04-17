/**
 * Send Reducer
 * Manages send flow state and transaction phases
 */

import { createReducerHook, type ActionsFrom } from "../utils";

// State
export type SendPhase = "idle" | "sending" | "generating_link" | "link_ready" | "error";

export interface SendState {
  token: "gc" | "gcp";
  recipientAddress: string;
  amount: string;
  phase: SendPhase;
  error: string | null;
  generatedLink: string | null;
}

export const initialSendState: SendState = {
  token: "gc",
  recipientAddress: "",
  amount: "",
  phase: "idle",
  error: null,
  generatedLink: null,
};

// Actions (namespaced with 'send/')
export const sendActions = {
  setToken: (token: "gc" | "gcp") => ({ type: "send/SET_TOKEN" as const, token }),
  setRecipientAddress: (address: string) => ({ type: "send/SET_RECIPIENT" as const, address }),
  setAmount: (amount: string) => ({ type: "send/SET_AMOUNT" as const, amount }),
  startSend: () => ({ type: "send/START_SEND" as const }),
  generatingLink: () => ({ type: "send/GENERATING_LINK" as const }),
  linkReady: (link: string) => ({ type: "send/LINK_READY" as const, link }),
  sendError: (error: string) => ({ type: "send/SEND_ERROR" as const, error }),
  dismissError: () => ({ type: "send/DISMISS_ERROR" as const }),
  reset: () => ({ type: "send/RESET" as const }),
};

export type SendAction = ActionsFrom<typeof sendActions>;

// Reducer
export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case "send/SET_TOKEN":
      return { ...state, token: action.token };
    case "send/SET_RECIPIENT":
      return { ...state, recipientAddress: action.address };
    case "send/SET_AMOUNT":
      return { ...state, amount: action.amount };
    case "send/START_SEND":
      return { ...state, phase: "sending", error: null, generatedLink: null };
    case "send/GENERATING_LINK":
      return { ...state, phase: "generating_link" };
    case "send/LINK_READY":
      return { ...state, phase: "link_ready", generatedLink: action.link };
    case "send/SEND_ERROR":
      return { ...state, phase: "error", error: action.error };
    case "send/DISMISS_ERROR":
      return { ...state, phase: "idle", error: null };
    case "send/RESET":
      return { ...initialSendState };
    default:
      return state;
  }
}

// Hook
export const useSendReducer = createReducerHook(sendReducer, sendActions, initialSendState);
