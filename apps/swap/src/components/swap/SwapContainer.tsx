/**
 * SwapContainer Component
 * Main swap interface using contexts
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Paper, Box, Collapse, Alert } from "@mui/material";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import { SwapBox } from "./SwapBox";
import { SwapProgress } from "./SwapProgress";
import { ExchangeRateDisplay } from "./ExchangeRateDisplay";
import { SwapButton } from "./SwapButton";
import { SwapErrorAlert } from "./SwapErrorAlert";
import { SubscriptionStatusBadge } from "./SubscriptionStatusBadge";
import { SponsorshipToggle } from "./SponsorshipToggle";
import { useContracts } from "../../contexts/contracts";
import { useWallet } from "../../contexts/wallet";
import { useOnboarding } from "../../contexts/onboarding";
import { useSwap } from "../../contexts/swap";
import { useSubscriptionStatus } from "../../hooks/useSubscriptionStatus";
import type { Balances } from "../../types";

export function SwapContainer() {
  const { isLoadingContracts, fetchBalances } = useContracts();
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const {
    status: onboardingStatus,
    startOnboarding,
    isDripping,
    dripPhase,
    dripError,
    dismissDripError,
  } = useOnboarding();

  const {
    fromAmount,
    toAmount,
    exchangeRate,
    isLoadingRate,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    phase: swapPhase,
    error: swapError,
    bypassSponsorship,
    setBypassSponsorship,
    setFromAmount,
    setToAmount,
    executeSwap,
    dismissError: dismissSwapError,
  } = useSwap();

  const subscriptionStatus = useSubscriptionStatus(swapPhase, dripPhase);
  const isBlocked = subscriptionStatus.kind === "full" || subscriptionStatus.kind === "depleted";

  // Drip success banner
  const [showDripSuccess, setShowDripSuccess] = useState(false);
  const dripSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dripPhase === "success") {
      setShowDripSuccess(true);
      dripSuccessTimerRef.current = setTimeout(() => setShowDripSuccess(false), 10000);
    }
    return () => {
      if (dripSuccessTimerRef.current) clearTimeout(dripSuccessTimerRef.current);
    };
  }, [dripPhase]);

  // Local balance state
  const [balances, setBalances] = useState<Balances>({ gregoCoin: null, gregoCoinPremium: null });
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  const swapErrorRef = useRef<HTMLDivElement | null>(null);

  const isOnboarded = onboardingStatus === "completed";

  // Fetch balances
  const refetchBalances = useCallback(async () => {
    if (!isOnboarded || !currentAddress) {
      setBalances({ gregoCoin: null, gregoCoinPremium: null });
      return;
    }

    setIsLoadingBalances(true);
    try {
      const [gcBalance, gcpBalance] = await fetchBalances();
      setBalances({ gregoCoin: gcBalance, gregoCoinPremium: gcpBalance });
    } catch {
      setBalances({ gregoCoin: null, gregoCoinPremium: null });
    } finally {
      setIsLoadingBalances(false);
    }
  }, [fetchBalances, currentAddress, isOnboarded]);

  // Clear balances when not onboarded or losing address
  useEffect(() => {
    if (!isOnboarded || !currentAddress) {
      setBalances({ gregoCoin: null, gregoCoinPremium: null });
    }
  }, [isOnboarded, currentAddress]);

  // Refetch balances when onboarding completes
  useEffect(() => {
    if (onboardingStatus === "completed") {
      refetchBalances();
    }
  }, [onboardingStatus, refetchBalances]);

  // Batched refresh after swap or drip success — single wallet roundtrip for
  // exchange rate + balances + subscription status
  useEffect(() => {
    if (swapPhase === "success") {
      refetchBalances();
    }
  }, [swapPhase, refetchBalances]);

  // Scroll to error when it appears
  useEffect(() => {
    if (swapError || dripError) {
      setTimeout(() => {
        swapErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [swapError, dripError]);

  const handleSwapClick = () => {
    setShowDripSuccess(false);
    if (!isOnboarded) {
      startOnboarding(true);
    } else {
      executeSwap();
    }
  };

  const handleMaxFromClick = () => {
    if (balances.gregoCoin !== null) {
      setFromAmount(balances.gregoCoin.toString());
    }
  };

  const handleMaxToClick = () => {
    if (balances.gregoCoinPremium !== null) {
      setToAmount(balances.gregoCoinPremium.toString());
    }
  };

  const showBalance = isOnboarded && currentAddress !== null;

  // Only disable inputs when swap is in progress
  const disableFromBox = isSwapping;
  const disableToBox = isSwapping;

  // Show "..." placeholder when rate is unavailable and opposite box has value
  const isRateUnavailable = isLoadingRate || exchangeRate === null;
  const fromPlaceholder = isRateUnavailable && toAmount !== "" ? "..." : "0.0";
  const toPlaceholder = isRateUnavailable && fromAmount !== "" ? "..." : "0.0";

  // Calculate if FROM amount exceeds balance
  const fromHasError =
    showBalance &&
    balances.gregoCoin !== null &&
    fromAmount !== "" &&
    parseFloat(fromAmount) > Number(balances.gregoCoin);

  // Combined error handling
  const displayError = swapError || dripError;
  const handleDismissError = () => {
    if (dripError) dismissDripError();
    if (swapError) dismissSwapError();
  };

  return (
    <Paper
      elevation={3}
      data-testid="swap-container"
      data-phase={swapPhase ?? "idle"}
      data-drip-phase={dripPhase}
      sx={{
        p: 3,
        backgroundColor: "background.paper",
        border: "1px solid",
        borderColor: "rgba(212, 255, 40, 0.2)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* From Token */}
      <SwapBox
        label="From"
        tokenName="GRG"
        value={fromAmount}
        onChange={setFromAmount}
        disabled={disableFromBox}
        usdValue={fromAmountUSD}
        balance={balances.gregoCoin}
        showBalance={showBalance}
        isLoadingBalance={isLoadingBalances}
        onMaxClick={handleMaxFromClick}
        placeholder={fromPlaceholder}
        hasError={fromHasError}
        testId="swap-from"
      />

      {/* Swap Direction Icon (visual only) */}
      <Box
        sx={{ display: "flex", justifyContent: "center", my: -2, position: "relative", zIndex: 1 }}
      >
        <Box
          sx={{
            backgroundColor: "rgba(18, 18, 28, 1)",
            border: "2px solid",
            borderColor: "rgba(212, 255, 40, 0.3)",
            color: "primary.main",
            boxShadow: "0 0 0 4px rgba(18, 18, 28, 1)",
            borderRadius: "50%",
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SwapVertIcon />
        </Box>
      </Box>

      {/* To Token */}
      <SwapBox
        label="To"
        tokenName="GRGP"
        value={toAmount}
        onChange={setToAmount}
        disabled={disableToBox}
        usdValue={toAmountUSD * 5}
        balance={balances.gregoCoinPremium}
        showBalance={showBalance}
        isLoadingBalance={isLoadingBalances}
        onMaxClick={handleMaxToClick}
        placeholder={toPlaceholder}
        testId="swap-to"
      />

      {/* Exchange Rate Info */}
      <ExchangeRateDisplay exchangeRate={exchangeRate} isLoadingRate={isLoadingRate} />

      {/* Drip success banner */}
      <Collapse in={showDripSuccess} timeout={{ enter: 300, exit: 600 }}>
        <Alert
          severity="success"
          onClose={() => setShowDripSuccess(false)}
          sx={{
            mt: 2,
            backgroundColor: "rgba(212, 255, 40, 0.08)",
            border: "1px solid rgba(212, 255, 40, 0.3)",
            color: "#D4FF28",
            "& .MuiAlert-icon": { color: "#D4FF28" },
            "& .MuiIconButton-root": { color: "#D4FF28" },
          }}
        >
          GregoCoin received — you're ready to swap!
        </Alert>
      </Collapse>

      {/* Swap Button or Progress */}
      {isSwapping ? (
        <SwapProgress />
      ) : (
        <>
          <SwapButton
            onClick={handleSwapClick}
            disabled={!canSwap || isDripping || isBlocked}
            contractsLoading={isLoadingContracts}
            hasAmount={!!fromAmount && parseFloat(fromAmount) > 0}
            subscriptionStatus={subscriptionStatus}
          />
          {!isUsingEmbeddedWallet && subscriptionStatus.kind !== "no_fpc" ? (
            <SponsorshipToggle
              status={subscriptionStatus}
              value={bypassSponsorship}
              onChange={setBypassSponsorship}
            />
          ) : (
            <SubscriptionStatusBadge status={subscriptionStatus} />
          )}
        </>
      )}

      {/* Error Display */}
      <SwapErrorAlert error={displayError} onDismiss={handleDismissError} errorRef={swapErrorRef} />
    </Paper>
  );
}
