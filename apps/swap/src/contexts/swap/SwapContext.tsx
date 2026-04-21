/**
 * Swap Context
 * Manages swap UI state and execution
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useContracts } from "../contracts";
import { useWallet } from "../wallet";
import { useOnboarding } from "../onboarding";
import { useSwapReducer, type SwapState } from "./reducer";
import { GREGOCOIN_USD_PRICE, EXCHANGE_RATE_POLL_INTERVAL_MS } from "../../types";

interface SwapContextType extends SwapState {
  // Computed values
  fromAmountUSD: number;
  toAmountUSD: number;
  canSwap: boolean;
  isSwapping: boolean;

  // Sponsorship opt-out (external wallets only)
  bypassSponsorship: boolean;
  setBypassSponsorship: (value: boolean) => void;

  // Actions
  setFromAmount: (amount: string) => void;
  setToAmount: (amount: string) => void;
  executeSwap: () => Promise<void>;
  dismissError: () => void;
  reset: () => void;
}

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export function useSwap() {
  const context = useContext(SwapContext);
  if (context === undefined) {
    throw new Error("useSwap must be used within a SwapProvider");
  }
  return context;
}

interface SwapProviderProps {
  children: ReactNode;
}

export function SwapProvider({ children }: SwapProviderProps) {
  const { swap, unsponsoredSwap, isLoadingContracts, getExchangeRate } = useContracts();
  const { isUsingEmbeddedWallet } = useWallet();
  const {
    status: onboardingStatus,
    onboardingResult,
    isSwapPending,
    isDripPending,
    clearSwapPending,
  } = useOnboarding();

  const [state, actions] = useSwapReducer();
  const [bypassSponsorship, setBypassSponsorship] = useState(false);

  // Reset bypass when switching back to embedded wallet
  useEffect(() => {
    if (isUsingEmbeddedWallet) {
      setBypassSponsorship(false);
    }
  }, [isUsingEmbeddedWallet]);

  // Refs for rate fetching and orchestration
  const isFetchingRateRef = useRef(false);
  const hasUsedOnboardingResultRef = useRef(false);
  const swapTriggeredRef = useRef(false);
  const prevExchangeRateRef = useRef<number | null>(null);

  // Computed value used by multiple effects
  const isSwapping = state.phase === "sending";

  // Internal swap execution (for use in effects)
  const doSwap = useCallback(async () => {
    if (isLoadingContracts || !state.fromAmount || parseFloat(state.fromAmount) <= 0) {
      actions.swapError("Cannot perform swap: Missing data or invalid amount");
      return;
    }

    actions.startSwap();

    try {
      const swapFn = bypassSponsorship ? unsponsoredSwap : swap;
      await swapFn(parseFloat(state.toAmount), parseFloat(state.fromAmount) * 1.1);
      actions.swapSuccess();
    } catch (error) {
      let errorMessage = "Swap failed. Please try again.";

      if (error instanceof Error) {
        if (error.message.includes("Simulation failed")) {
          errorMessage = error.message;
        } else if (error.message.includes("User denied") || error.message.includes("rejected")) {
          errorMessage = "Transaction was rejected in wallet";
        } else if (
          error.message.includes("Insufficient") ||
          error.message.includes("insufficient")
        ) {
          errorMessage = "Insufficient GregoCoin balance for swap";
        } else {
          errorMessage = error.message;
        }
      }

      actions.swapError(errorMessage);
    }
  }, [
    isLoadingContracts,
    state.fromAmount,
    state.toAmount,
    swap,
    unsponsoredSwap,
    bypassSponsorship,
    actions,
  ]);

  // Pre-populate exchange rate from onboarding result
  useEffect(() => {
    if (onboardingResult && !hasUsedOnboardingResultRef.current) {
      actions.setRate(onboardingResult.exchangeRate);
      hasUsedOnboardingResultRef.current = true;
    }
  }, [onboardingResult, actions]);

  // Execute swap when onboarding completes with pending swap
  useEffect(() => {
    if (onboardingStatus === "completed" && isSwapPending && !swapTriggeredRef.current) {
      swapTriggeredRef.current = true;
      doSwap();
    }
  }, [onboardingStatus, isSwapPending, doSwap]);

  // Clear pending flag after swap completes
  useEffect(() => {
    if (swapTriggeredRef.current && isSwapPending && !isSwapping) {
      swapTriggeredRef.current = false;
      clearSwapPending();
    }
  }, [isSwapPending, isSwapping, clearSwapPending]);

  // Recalculate amounts when exchange rate becomes available
  useEffect(() => {
    const wasUnavailable = prevExchangeRateRef.current === null;
    const isNowAvailable = state.exchangeRate !== null;

    if (wasUnavailable && isNowAvailable) {
      if (state.fromAmount !== "" && state.toAmount === "") {
        const numValue = parseFloat(state.fromAmount);
        if (!isNaN(numValue)) {
          actions.setToAmount((numValue * state.exchangeRate).toFixed(6));
        }
      } else if (state.toAmount !== "" && state.fromAmount === "") {
        const numValue = parseFloat(state.toAmount);
        if (!isNaN(numValue)) {
          actions.setFromAmount((numValue / state.exchangeRate).toFixed(6));
        }
      }
    }

    prevExchangeRateRef.current = state.exchangeRate;
  }, [state.exchangeRate, state.fromAmount, state.toAmount, actions]);

  // Reset exchange rate when contracts are loading
  useEffect(() => {
    if (isLoadingContracts) {
      actions.setLoadingRate(false);
      isFetchingRateRef.current = false;
    }
  }, [isLoadingContracts, actions]);

  // Fetch exchange rate with auto-refresh
  useEffect(() => {
    async function fetchExchangeRate() {
      const isSwapping = state.phase === "sending";
      const isBusy = isLoadingContracts || isSwapping || isSwapPending || isDripPending;
      const isOnboardingInProgress =
        onboardingStatus !== "completed" && onboardingStatus !== "idle";

      if (isBusy || isOnboardingInProgress) {
        actions.setLoadingRate(false);
        return;
      }

      if (isFetchingRateRef.current) {
        return;
      }

      try {
        isFetchingRateRef.current = true;
        actions.setLoadingRate(true);

        const rate = await getExchangeRate();
        actions.setRate(rate);
      } finally {
        actions.setLoadingRate(false);
        isFetchingRateRef.current = false;
      }
    }

    fetchExchangeRate();

    const intervalId = setInterval(() => {
      fetchExchangeRate();
    }, EXCHANGE_RATE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      actions.setLoadingRate(false);
      isFetchingRateRef.current = false;
    };
  }, [
    isLoadingContracts,
    state.phase,
    isDripPending,
    getExchangeRate,
    onboardingStatus,
    isSwapPending,
    actions,
  ]);

  // Amount change handlers with recalculation
  const setFromAmount = useCallback(
    (value: string) => {
      actions.setFromAmount(value);

      if (value === "" || state.exchangeRate === null) {
        actions.setToAmount("");
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          actions.setToAmount((numValue * state.exchangeRate).toFixed(6));
        }
      }
    },
    [state.exchangeRate, actions],
  );

  const setToAmount = useCallback(
    (value: string) => {
      actions.setToAmount(value);

      if (value === "" || state.exchangeRate === null) {
        actions.setFromAmount("");
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          actions.setFromAmount((numValue / state.exchangeRate).toFixed(6));
        }
      }
    },
    [state.exchangeRate, actions],
  );

  // Computed values
  const fromAmountUSD = state.fromAmount ? parseFloat(state.fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = state.toAmount ? parseFloat(state.toAmount) * GREGOCOIN_USD_PRICE : 0;

  const canSwap =
    !!state.fromAmount &&
    parseFloat(state.fromAmount) > 0 &&
    !isLoadingContracts &&
    (onboardingStatus === "idle" || onboardingStatus === "completed");

  const value: SwapContextType = {
    ...state,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    bypassSponsorship,
    setBypassSponsorship,
    setFromAmount,
    setToAmount,
    executeSwap: doSwap,
    dismissError: actions.dismissError,
    reset: actions.reset,
  };

  return <SwapContext.Provider value={value}>{children}</SwapContext.Provider>;
}
