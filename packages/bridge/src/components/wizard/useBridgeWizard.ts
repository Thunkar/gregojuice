import { useState, useEffect, useCallback, useReducer, useRef } from "react";
import { formatUnits, parseUnits } from "viem";
import { useWallet } from "../../contexts/WalletContext";
import { useNetwork } from "../../contexts/NetworkContext";
import { useAztecWallet } from "../../contexts/AztecWalletContext";
import {
  fetchL1Addresses,
  getFeeJuiceBalance,
  getMintAmount,
  bridgeFeeJuice,
  bridgeDouble,
  pollMessageReadiness,
  waitForAztecTx,
  resumePendingBridge,
  type L1Addresses,
} from "../../services/bridgeService";
import { txProgress } from "../../wallet";
import { determineClaimPath } from "./claim-path";
import {
  loadSession,
  clearSession,
  saveSession,
  sessionToPhase,
  phaseToSession,
} from "./session";
import type {
  WizardStep,
  AztecChoice,
  RecipientChoice,
  BridgePhase,
  BridgeAction,
  BridgeStep,
} from "./types";

// ── Reducer ───────────────────────────────────────────────────────────

const IDLE: BridgePhase = { type: "idle" } as const;

function bridgeReducer(state: BridgePhase, action: BridgeAction): BridgePhase {
  switch (action.type) {
    case "BRIDGE_STARTED":
      return { type: "l1-pending", pendingBridge: action.pendingBridge };

    case "L1_CONFIRMED":
      return {
        type: "waiting-l2-sync",
        credentials: action.credentials,
        ephemeral: action.ephemeral,
        messageReady: false,
        ephMessageReady: !action.ephemeral,
      };

    case "MESSAGE_READY": {
      if (state.type !== "waiting-l2-sync") return state;
      const newMessageReady = action.which === "main" ? true : state.messageReady;
      const newEphReady = action.which === "ephemeral" ? true : state.ephMessageReady;
      // If both messages are now ready AND wallet is ready, try to transition
      if (newMessageReady && newEphReady && action.walletReady) {
        const claimPath = determineClaimPath(
          action.recipientChoice,
          state.ephemeral,
          state.credentials,
          action.feeJuiceBalance,
        );
        if (claimPath) {
          return {
            type: "ready-to-claim",
            credentials: state.credentials,
            ephemeral: state.ephemeral,
            claimPath,
          };
        }
      }
      return { ...state, messageReady: newMessageReady, ephMessageReady: newEphReady };
    }

    case "WALLET_READY": {
      // Only meaningful in waiting-l2-sync when both messages are ready
      if (state.type !== "waiting-l2-sync") return state;
      if (!state.messageReady || !state.ephMessageReady) return state;
      const claimPath = determineClaimPath(
        action.recipientChoice,
        state.ephemeral,
        state.credentials,
        action.feeJuiceBalance,
      );
      if (!claimPath) return state; // can't claim yet, stay in waiting-l2-sync
      return {
        type: "ready-to-claim",
        credentials: state.credentials,
        ephemeral: state.ephemeral,
        claimPath,
      };
    }

    case "WALLET_NOT_READY": {
      // If we were ready-to-claim but wallet disconnected, go back
      if (state.type !== "ready-to-claim") return state;
      return {
        type: "waiting-l2-sync",
        credentials: state.credentials,
        ephemeral: state.ephemeral,
        messageReady: true,
        ephMessageReady: true,
      };
    }

    case "CLAIM_STARTED": {
      if (state.type !== "ready-to-claim") return state;
      return {
        type: "claiming",
        credentials: state.credentials,
        ephemeral: state.ephemeral,
        claimPath: state.claimPath,
      };
    }

    case "TX_SENT": {
      if (state.type !== "claiming") return state;
      return {
        type: "claim-sent",
        credentials: state.credentials,
        txHash: action.txHash,
        snapshot: action.snapshot,
      };
    }

    case "CLAIM_DONE":
      // Accept from claiming (fast path — no TX_SENT event) or claim-sent
      if (state.type !== "claiming" && state.type !== "claim-sent") return state;
      return { type: "done" };

    case "ERROR":
      return { type: "error", message: action.message };

    case "RESET":
      return IDLE;

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useBridgeWizard() {
  const { account, connect } = useWallet();
  const { activeNetwork } = useNetwork();
  const {
    status: aztecStatus,
    address: aztecAddress,
    feeJuiceBalance,
    connectAztecWallet,
    claimSelf,
    claimForRecipient,
    claimBoth,
    resetAccount,
    refreshFeeJuiceBalance,
    isExternal,
    error: aztecError,
  } = useAztecWallet();

  // ── Session restore (computed once) ─────────────────────────────────
  const [initialSession] = useState(() => loadSession(activeNetwork.id));
  const hasSession = !!initialSession;

  // ── Bridge state machine ────────────────────────────────────────────
  const [bridge, dispatch] = useReducer(
    bridgeReducer,
    initialSession,
    (session): BridgePhase => (session ? sessionToPhase(session) : IDLE),
  );

  // ── Wizard navigation ───────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    hasSession ? (initialSession?.isExternal ? 2 : 4) : 1,
  );
  const [expandedStep, setExpandedStep] = useState<WizardStep>(
    hasSession ? (initialSession?.isExternal ? 2 : 4) : 1,
  );
  const [error, setError] = useState<string | null>(null);

  // ── Step 1: L1 wallet state ─────────────────────────────────────────
  const [l1Addresses, setL1Addresses] = useState<(L1Addresses & { l1ChainId: number }) | null>(null);
  const [balance, setBalance] = useState<{ balance: bigint; formatted: string; decimals: number } | null>(null);
  const [mintAmountValue, setMintAmountValue] = useState<bigint | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

  // ── Step 2: Aztec account choice ────────────────────────────────────
  const [aztecChoice, setAztecChoice] = useState<AztecChoice>(
    hasSession ? (initialSession?.isExternal ? "existing" : "new") : null,
  );

  // ── Step 3: Recipient ───────────────────────────────────────────────
  const [recipientChoice, setRecipientChoice] = useState<RecipientChoice>(
    initialSession?.recipientChoice ?? null,
  );
  const [manualAddress, setManualAddress] = useState(initialSession?.recipient ?? "");

  // ── Step 4: Amount + UI state ───────────────────────────────────────
  const [amount, setAmount] = useState(initialSession?.amount ?? "");
  const [bridgeStepLabel, setBridgeStepLabel] = useState(
    bridge.type === "l1-pending" ? "Resuming — waiting for L1 confirmation..." : "",
  );

  // ── Derived values ──────────────────────────────────────────────────

  const hasFaucet = !!l1Addresses?.feeAssetHandler;
  const hasBalance = balance != null && balance.balance > 0n;
  const faucetLocked = hasFaucet && !hasBalance;

  const aztecAccountReady =
    aztecChoice === "existing"
      ? aztecStatus === "funded"
      : aztecStatus === "ready" || aztecStatus === "funded";

  const effectiveRecipient =
    recipientChoice === "self"
      ? (aztecAddress?.toString() ?? "")
      : manualAddress;

  const recipientReady =
    recipientChoice === "self" ? !!aztecAddress : manualAddress.length >= 10;

  const needsDualBridge =
    aztecChoice === "new" &&
    recipientChoice === "other" &&
    aztecStatus !== "funded";

  const bridgeDone =
    bridge.type === "waiting-l2-sync" ||
    bridge.type === "ready-to-claim" ||
    bridge.type === "claiming" ||
    bridge.type === "claim-sent" ||
    bridge.type === "done";

  const syncDone =
    bridge.type === "ready-to-claim" ||
    bridge.type === "claiming" ||
    bridge.type === "claim-sent" ||
    bridge.type === "done" ||
    (bridge.type === "waiting-l2-sync" && bridge.messageReady && bridge.ephMessageReady);

  const claimed = bridge.type === "done";
  const isClaiming = bridge.type === "claiming" || bridge.type === "claim-sent";
  const isBridging = bridge.type === "l1-pending";
  const walletReady = aztecStatus === "ready" || aztecStatus === "funded";

  // Refs for current values — used by polling callbacks in the orchestrator
  // so they always read fresh values without re-running the effect.
  const walletReadyRef = useRef(walletReady);
  const recipientChoiceRef = useRef(recipientChoice);
  const feeJuiceBalanceRef = useRef(feeJuiceBalance);
  walletReadyRef.current = walletReady;
  recipientChoiceRef.current = recipientChoice;
  feeJuiceBalanceRef.current = feeJuiceBalance;

  // ── Effect: Wallet status relay ─────────────────────────────────────
  // Tells the reducer when external conditions change so it can transition
  // waiting-l2-sync → ready-to-claim (or ready-to-claim → waiting-l2-sync).

  useEffect(() => {
    if (walletReady) {
      dispatch({ type: "WALLET_READY", recipientChoice, feeJuiceBalance });
    } else {
      dispatch({ type: "WALLET_NOT_READY" });
    }
  }, [walletReady, recipientChoice, feeJuiceBalance]);

  // ── Effect: Orchestrator ────────────────────────────────────────────
  // Single effect that kicks off async work based on the current phase.
  // Only re-runs when bridge.type changes (phase transitions).

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    switch (bridge.type) {
      case "l1-pending": {
        const { pendingBridge } = bridge;
        resumePendingBridge(activeNetwork.l1ChainId, pendingBridge)
          .then((result) => {
            if (cancelled) return;
            if ("ephemeral" in result) {
              dispatch({ type: "L1_CONFIRMED", credentials: result.main, ephemeral: result.ephemeral });
            } else {
              dispatch({ type: "L1_CONFIRMED", credentials: result, ephemeral: null });
            }
          })
          .catch((err) => {
            if (!cancelled) dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "L1 resume failed" });
          });
        break;
      }

      case "waiting-l2-sync": {
        const cancellers: Array<() => void> = [];
        // Polling callbacks read from refs so they always have fresh values
        const makeMessageAction = (which: "main" | "ephemeral") => ({
          type: "MESSAGE_READY" as const,
          which,
          recipientChoice: recipientChoiceRef.current,
          feeJuiceBalance: feeJuiceBalanceRef.current,
          walletReady: walletReadyRef.current,
        });
        if (!bridge.messageReady) {
          const { cancel } = pollMessageReadiness(
            activeNetwork.aztecNodeUrl,
            bridge.credentials.messageHash,
            (status) => { if (status === "ready") dispatch(makeMessageAction("main")); },
          );
          cancellers.push(cancel);
        }
        if (bridge.ephemeral && !bridge.ephMessageReady) {
          const { cancel } = pollMessageReadiness(
            activeNetwork.aztecNodeUrl,
            bridge.ephemeral.messageHash,
            (status) => { if (status === "ready") dispatch(makeMessageAction("ephemeral")); },
          );
          cancellers.push(cancel);
        }
        // If messages were already ready (restore), immediately re-check wallet
        if (bridge.messageReady && bridge.ephMessageReady && walletReady) {
          dispatch({ type: "WALLET_READY", recipientChoice, feeJuiceBalance });
        }
        cleanup = () => cancellers.forEach((c) => c());
        break;
      }

      case "ready-to-claim": {
        // Auto-trigger: transition to claiming immediately
        dispatch({ type: "CLAIM_STARTED" });
        break;
      }

      case "claiming": {
        const { credentials, claimPath } = bridge;

        // Subscribe to txProgress BEFORE starting the claim.
        // Capture the hash from "sending" (mining event doesn't carry it).
        let capturedTxHash: string | null = null;
        const unsub = txProgress.subscribe((event) => {
          if (event.phase === "sending" && event.aztecTxHash) {
            capturedTxHash = event.aztecTxHash;
            dispatch({
              type: "TX_SENT",
              txHash: event.aztecTxHash,
              snapshot: {
                txId: event.txId,
                label: event.label,
                phases: event.phases,
                startTime: event.startTime,
                aztecTxHash: event.aztecTxHash,
              },
            });
          }
        });

        // Fire the claim. We only catch pre-send errors here.
        // Post-send completion is handled by the claim-sent phase.
        const claimPromise = (async () => {
          switch (claimPath.kind) {
            case "self":
              return claimSelf(credentials);
            case "both":
              return claimBoth(claimPath.ephemeral, credentials, credentials.recipient);
            case "for-recipient":
              return claimForRecipient(credentials, credentials.recipient);
          }
        })();

        claimPromise
          .then(() => {
            // If we never got a TX_SENT event (e.g. external wallet path),
            // the claim completed fully — go straight to done.
            if (!capturedTxHash && !cancelled) {
              dispatch({ type: "CLAIM_DONE" });
            }
          })
          .catch((err) => {
            if (!cancelled) dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "Claim failed" });
          });

        cleanup = unsub;
        break;
      }

      case "claim-sent": {
        const { txHash, snapshot } = bridge;
        const miningStart = Date.now();

        // Re-emit mining event for TxNotificationCenter
        const timer = setTimeout(() => {
          txProgress.emit({
            txId: snapshot.txId,
            label: snapshot.label,
            phase: "mining",
            startTime: snapshot.startTime,
            phaseStartTime: miningStart,
            phases: snapshot.phases,
            aztecTxHash: txHash,
          });
        }, 0);

        waitForAztecTx(activeNetwork.aztecNodeUrl, txHash)
          .then(() => {
            if (cancelled) return;
            dispatch({ type: "CLAIM_DONE" });
            txProgress.emit({
              txId: snapshot.txId,
              label: snapshot.label,
              phase: "complete",
              startTime: snapshot.startTime,
              phaseStartTime: Date.now(),
              phases: [...snapshot.phases, { name: "Mining", duration: Date.now() - miningStart, color: "#4caf50" }],
              aztecTxHash: txHash,
            });
          })
          .catch((err) => {
            if (cancelled) return;
            dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "Claim tx failed" });
            txProgress.emit({
              txId: snapshot.txId,
              label: snapshot.label,
              phase: "error",
              startTime: snapshot.startTime,
              phaseStartTime: Date.now(),
              phases: [...snapshot.phases, { name: "Mining", duration: Date.now() - miningStart, color: "#4caf50" }],
              error: err instanceof Error ? err.message : "Claim tx failed",
            });
          });

        cleanup = () => clearTimeout(timer);
        break;
      }
    }

    return () => { cancelled = true; cleanup?.(); };
  }, [bridge.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: Persistence ─────────────────────────────────────────────
  // Single writer per phase. No races.

  useEffect(() => {
    if (bridge.type === "done") { clearSession(); return; }
    if (bridge.type === "idle" || bridge.type === "error") return;

    const session = phaseToSession(bridge, {
      recipientChoice: recipientChoice ?? "self",
      isExternal,
      amount,
      recipient: effectiveRecipient,
      networkId: activeNetwork.id,
    });
    if (session) saveSession(session);
  }, [bridge, recipientChoice, isExternal, amount, effectiveRecipient, activeNetwork.id]);

  // ── Effect: Propagate reducer errors ────────────────────────────────
  useEffect(() => {
    if (bridge.type === "error") setError(bridge.message);
  }, [bridge]);

  // ── Effect: Refresh balance after claim ─────────────────────────────
  useEffect(() => {
    if (claimed) refreshFeeJuiceBalance();
  }, [claimed, refreshFeeJuiceBalance]);

  // ── Step 1: Fetch L1 info ───────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setL1Addresses(null);
    setBalance(null);
    setMintAmountValue(null);
    setIsLoadingInfo(true);
    fetchL1Addresses(activeNetwork.aztecNodeUrl)
      .then((addresses) => {
        if (cancelled) return;
        setL1Addresses(addresses);
        if (addresses.feeAssetHandler)
          getMintAmount(activeNetwork.l1RpcUrl, addresses.l1ChainId, addresses.feeAssetHandler)
            .then((amt) => { if (!cancelled) setMintAmountValue(amt); })
            .catch(() => {});
      })
      .catch((err) => {
        if (!cancelled) setError(`Failed to fetch L1 addresses: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInfo(false);
      });
    return () => { cancelled = true; };
  }, [activeNetwork]);

  const refreshBalance = useCallback(async () => {
    if (!account || !l1Addresses) { setBalance(null); return; }
    try {
      setBalance(await getFeeJuiceBalance(activeNetwork.l1RpcUrl, l1Addresses.l1ChainId, l1Addresses.feeJuice, account));
    } catch {
      setBalance({ balance: 0n, formatted: "0", decimals: 18 });
    }
  }, [account, l1Addresses, activeNetwork]);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  // Auto-advance from step 1
  useEffect(() => {
    if (account && l1Addresses && balance && wizardStep === 1) {
      setWizardStep(2);
      setExpandedStep(2);
    }
  }, [account, l1Addresses, balance, wizardStep]);

  // ── Step 2: Aztec account ───────────────────────────────────────────

  useEffect(() => {
    if (aztecChoice === "new" && aztecStatus === "disconnected")
      connectAztecWallet();
  }, [aztecChoice, aztecStatus, connectAztecWallet]);

  // Auto-advance from step 2
  useEffect(() => {
    if (wizardStep === 2 && aztecAccountReady) {
      setWizardStep(3);
      setExpandedStep(3);
    }
  }, [wizardStep, aztecAccountReady]);

  // ── Step 3: Recipient ───────────────────────────────────────────────

  useEffect(() => {
    if (!isExternal && recipientChoice !== "other") setRecipientChoice("other");
  }, [isExternal, recipientChoice]);

  const advanceFromStep3 = useCallback(() => {
    if (recipientReady && wizardStep === 3) {
      setWizardStep(4);
      setExpandedStep(4);
      if (faucetLocked && mintAmountValue != null)
        setAmount(formatUnits(mintAmountValue, 18));
    }
  }, [recipientReady, wizardStep, faucetLocked, mintAmountValue]);

  useEffect(() => {
    if (recipientChoice === "self" && recipientReady && wizardStep === 3)
      advanceFromStep3();
  }, [recipientChoice, recipientReady, wizardStep, advanceFromStep3]);

  // ── Step 4: Bridge action ───────────────────────────────────────────

  const onBridgeStep = useCallback((_step: BridgeStep, label?: string) => {
    if (label) setBridgeStepLabel(label);
  }, []);

  const handleBridge = async () => {
    if (!account || !l1Addresses) return;
    setError(null);
    try {
      if (!amount) { setError("Please enter an amount"); return; }
      const bridgeAmount = parseUnits(amount, balance?.decimals ?? 18);
      if (bridgeAmount <= 0n) { setError("Amount must be greater than 0"); return; }
      if (!effectiveRecipient || effectiveRecipient.length < 10) { setError("Invalid recipient"); return; }

      if (needsDualBridge && aztecAddress) {
        const ephAmount = faucetLocked && mintAmountValue ? mintAmountValue : parseUnits("100", 18);
        const totalNeeded = bridgeAmount + (faucetLocked ? 0n : ephAmount);
        if (!faucetLocked && balance && totalNeeded > balance.balance) {
          setError(`Insufficient balance. Need ${formatUnits(totalNeeded, balance.decimals)} (${formatUnits(bridgeAmount, balance.decimals)} for recipient + ${formatUnits(ephAmount, balance.decimals)} for claimer gas)`);
          return;
        }
        const result = await bridgeDouble({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          ephemeralRecipient: aztecAddress.toString(),
          ephemeralAmount: ephAmount,
          mainRecipient: effectiveRecipient,
          mainAmount: bridgeAmount,
          mint: faucetLocked,
          onStep: onBridgeStep,
          onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
        });
        dispatch({ type: "L1_CONFIRMED", credentials: result.main, ephemeral: result.ephemeral });
      } else {
        if (!faucetLocked && balance && bridgeAmount > balance.balance) {
          setError("Insufficient balance");
          return;
        }
        const result = await bridgeFeeJuice({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          aztecRecipient: effectiveRecipient,
          amount: bridgeAmount,
          mint: faucetLocked,
          onStep: onBridgeStep,
          onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
        });
        dispatch({ type: "L1_CONFIRMED", credentials: result, ephemeral: null });
      }
      await refreshBalance();
    } catch (err: unknown) {
      dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "Bridge failed" });
    }
  };

  const handleReset = () => {
    clearSession();
    dispatch({ type: "RESET" });
    setWizardStep(1);
    setExpandedStep(1);
    setBridgeStepLabel("");
    setAztecChoice(null);
    setRecipientChoice(null);
    setManualAddress("");
    setAmount("");
    setError(null);
  };

  // ── Step status helpers ─────────────────────────────────────────────

  const toggle = (s: WizardStep) =>
    setExpandedStep((prev) => (prev === s ? (0 as unknown as WizardStep) : s));

  const stepStatus = (s: WizardStep): "completed" | "active" | "pending" => {
    if (s < wizardStep) return "completed";
    if (s === wizardStep) {
      if (s === 4 && claimed) return "completed";
      return "active";
    }
    return "pending";
  };

  const messageStatus: "ready" | "pending" | "error" =
    bridge.type === "waiting-l2-sync"
      ? bridge.messageReady ? "ready" : "pending"
      : bridgeDone ? "ready" : "pending";

  const ephMessageStatus: "ready" | "pending" | "error" =
    bridge.type === "waiting-l2-sync"
      ? bridge.ephMessageReady ? "ready" : "pending"
      : "ready";

  const bridgeStep: BridgeStep =
    bridge.type === "l1-pending" ? "waiting-confirmation"
      : bridge.type === "error" ? "error"
      : bridge.type === "idle" ? "idle"
      : "done";

  const credentials =
    bridge.type === "waiting-l2-sync" || bridge.type === "ready-to-claim" ||
    bridge.type === "claiming" || bridge.type === "claim-sent"
      ? bridge.credentials : null;

  const ephemeralCredentials =
    bridge.type === "waiting-l2-sync" || bridge.type === "ready-to-claim" || bridge.type === "claiming"
      ? bridge.ephemeral : null;

  const step4Desc = claimed
    ? "Complete!"
    : bridgeDone
      ? syncDone
        ? "Ready to claim"
        : "Waiting for L2 sync..."
      : "Bridge and claim fee juice";

  const progress =
    ((wizardStep - 1) / 4) * 100 +
    (bridgeDone ? (syncDone ? (claimed ? 25 : 18) : 10) : 0);

  return {
    account, connect, activeNetwork, aztecStatus, aztecAddress, feeJuiceBalance,
    aztecError, isExternal, resetAccount,
    wizardStep, expandedStep, toggle, stepStatus, progress,
    l1Addresses, balance, isLoadingInfo, hasFaucet, hasBalance, faucetLocked, mintAmountValue,
    aztecChoice, setAztecChoice, aztecAccountReady,
    recipientChoice, setRecipientChoice, manualAddress, setManualAddress,
    effectiveRecipient, recipientReady, advanceFromStep3,
    amount, setAmount, bridgeStep, bridgeStepLabel, credentials, ephemeralCredentials,
    messageStatus, ephMessageStatus, claimed, isClaiming, needsDualBridge, isBridging,
    bridgeDone, syncDone, step4Desc, handleBridge, handleReset,
    error, setError,
  };
}
