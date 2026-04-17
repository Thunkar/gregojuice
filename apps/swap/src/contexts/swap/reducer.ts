/**
 * Swap Reducer
 * Manages swap UI state and transaction phases
 */

import { createReducerHook, type ActionsFrom } from "../utils";

// =============================================================================
// State
// =============================================================================

export type SwapPhase = "idle" | "sending" | "success" | "error";

export interface SwapState {
  fromAmount: string;
  toAmount: string;
  exchangeRate: number | null;
  isLoadingRate: boolean;
  phase: SwapPhase;
  error: string | null;
}

export const initialSwapState: SwapState = {
  fromAmount: "",
  toAmount: "",
  exchangeRate: null,
  isLoadingRate: false,
  phase: "idle",
  error: null,
};

// =============================================================================
// Actions
// =============================================================================

export const swapActions = {
  setFromAmount: (amount: string) => ({ type: "swap/SET_FROM_AMOUNT" as const, amount }),
  setToAmount: (amount: string) => ({ type: "swap/SET_TO_AMOUNT" as const, amount }),
  setRate: (rate: number) => ({ type: "swap/SET_RATE" as const, rate }),
  setLoadingRate: (loading: boolean) => ({ type: "swap/SET_LOADING_RATE" as const, loading }),
  startSwap: () => ({ type: "swap/START_SWAP" as const }),
  swapSuccess: () => ({ type: "swap/SWAP_SUCCESS" as const }),
  swapError: (error: string) => ({ type: "swap/SWAP_ERROR" as const, error }),
  dismissError: () => ({ type: "swap/DISMISS_ERROR" as const }),
  reset: () => ({ type: "swap/RESET" as const }),
};

export type SwapAction = ActionsFrom<typeof swapActions>;

// =============================================================================
// Reducer
// =============================================================================

export function swapReducer(state: SwapState, action: SwapAction): SwapState {
  switch (action.type) {
    case "swap/SET_FROM_AMOUNT":
      return { ...state, fromAmount: action.amount };

    case "swap/SET_TO_AMOUNT":
      return { ...state, toAmount: action.amount };

    case "swap/SET_RATE":
      return { ...state, exchangeRate: action.rate, isLoadingRate: false };

    case "swap/SET_LOADING_RATE":
      return { ...state, isLoadingRate: action.loading };

    case "swap/START_SWAP":
      return { ...state, phase: "sending", error: null };

    case "swap/SWAP_SUCCESS":
      return { ...state, phase: "success", fromAmount: "", toAmount: "" };

    case "swap/SWAP_ERROR":
      return { ...state, phase: "error", error: action.error };

    case "swap/DISMISS_ERROR":
      return { ...state, phase: "idle", error: null };

    case "swap/RESET":
      return { ...initialSwapState, exchangeRate: state.exchangeRate };

    default:
      return state;
  }
}

// =============================================================================
// Hook
// =============================================================================

export const useSwapReducer = createReducerHook(swapReducer, swapActions, initialSwapState);
