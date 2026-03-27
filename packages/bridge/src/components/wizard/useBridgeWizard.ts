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
  bridgeMultiple,
  pollMessageReadiness,
  waitForAztecTx,
  resumePendingBridge,
  type L1Addresses,
} from "../../services/bridgeService";
import { txProgress } from "@gregojuice/embedded-wallet";
import { getQueryParams } from "../../config/query-params";
import { determineClaimPath } from "./claim-path";
import {
  loadSession,
  clearSession,
  saveSession,
  sessionToPhase,
  phaseToSession,
} from "./session";
import { EPHEMERAL_CLAIM_GAS_FJ } from "./constants";
import type {
  WizardStep,
  AztecChoice,
  RecipientChoice,
  BridgePhase,
  BridgeAction,
  BridgeStep,
  ClaimCredentials,
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
        allCredentials: action.allCredentials,
        messagesReady: action.allCredentials.map(() => false),
      };

    case "MESSAGE_READY": {
      if (state.type !== "waiting-l2-sync") return state;
      const newReady = [...state.messagesReady];
      newReady[action.index] = true;
      const allReady = newReady.every(Boolean);
      if (allReady && action.walletReady) {
        const claimPath = determineClaimPath(
          action.recipientChoice,
          state.allCredentials,
          action.feeJuiceBalance,
        );
        if (claimPath) {
          return { type: "ready-to-claim", allCredentials: state.allCredentials, claimPath };
        }
      }
      return { ...state, messagesReady: newReady };
    }

    case "WALLET_READY": {
      if (state.type !== "waiting-l2-sync") return state;
      if (!state.messagesReady.every(Boolean)) return state;
      const claimPath = determineClaimPath(
        action.recipientChoice,
        state.allCredentials,
        action.feeJuiceBalance,
      );
      if (!claimPath) return state;
      return { type: "ready-to-claim", allCredentials: state.allCredentials, claimPath };
    }

    case "WALLET_NOT_READY": {
      if (state.type !== "ready-to-claim") return state;
      return {
        type: "waiting-l2-sync",
        allCredentials: state.allCredentials,
        messagesReady: state.allCredentials.map(() => true),
      };
    }

    case "CLAIM_STARTED": {
      if (state.type !== "ready-to-claim") return state;
      return { type: "claiming", allCredentials: state.allCredentials, claimPath: state.claimPath };
    }

    case "TX_SENT": {
      if (state.type !== "claiming") return state;
      return {
        type: "claim-sent",
        allCredentials: state.allCredentials,
        txHash: action.txHash,
        snapshot: action.snapshot,
      };
    }

    case "CLAIM_DONE":
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
    claimAll,
    resetAccount,
    refreshFeeJuiceBalance,
    isExternal,
    error: aztecError,
  } = useAztecWallet();

  // ── Iframe / query-param overrides ────────────────────────────────
  const [{ recipients: queryRecipients, isIframe, forceEmbedded }] = useState(getQueryParams);

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
    forceEmbedded ? "new" : hasSession ? (initialSession?.isExternal ? "existing" : "new") : null,
  );

  // ── Step 3: Recipient ───────────────────────────────────────────────
  const [recipientChoice, setRecipientChoice] = useState<RecipientChoice>(
    queryRecipients ? "other" : (initialSession?.recipientChoice ?? null),
  );
  // Unified recipients list: addresses collected in Step 3, amounts in Step 4
  const [recipients, setRecipients] = useState<Array<{ address: string; amount: string }>>(() => {
    if (queryRecipients) return queryRecipients.map((r) => ({ address: r.address, amount: r.amount ? (Number(r.amount) / 1e18).toString() : "" }));
    if (initialSession?.recipients?.length) return initialSession.recipients;
    return [{ address: "", amount: "" }];
  });

  // ── Step 4: Amount + UI state ───────────────────────────────────────
  // Primary amount reads/writes recipients[0].amount
  const amount = recipients[0]?.amount ?? "";
  const setAmount = useCallback((val: string) => {
    setRecipients((prev) => {
      const updated = [...prev];
      updated[0] = { ...updated[0], amount: val };
      return updated;
    });
  }, []);
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
      : (recipients[0]?.address ?? "");

  const recipientReady =
    recipientChoice === "self"
      ? !!aztecAddress
      : recipients.length > 0 && recipients.every((r) => r.address.length >= 10);

  const needsMultiBridge =
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
    (bridge.type === "waiting-l2-sync" && bridge.messagesReady.every(Boolean));

  const claimed = bridge.type === "done";
  const isClaiming = bridge.type === "claiming" || bridge.type === "claim-sent";
  const isBridging = bridge.type === "l1-pending";
  const walletReady = aztecStatus === "ready" || aztecStatus === "funded";

  const walletReadyRef = useRef(walletReady);
  const recipientChoiceRef = useRef(recipientChoice);
  const feeJuiceBalanceRef = useRef(feeJuiceBalance);
  const lastCredentialsRef = useRef<ClaimCredentials[] | null>(null);
  walletReadyRef.current = walletReady;
  recipientChoiceRef.current = recipientChoice;
  feeJuiceBalanceRef.current = feeJuiceBalance;

  // ── Effect: Wallet status relay ─────────────────────────────────────

  useEffect(() => {
    if (walletReady) {
      dispatch({ type: "WALLET_READY", recipientChoice, feeJuiceBalance });
    } else {
      dispatch({ type: "WALLET_NOT_READY" });
    }
  }, [walletReady, recipientChoice, feeJuiceBalance]);

  // ── Effect: Orchestrator ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    switch (bridge.type) {
      case "l1-pending": {
        const { pendingBridge } = bridge;
        resumePendingBridge(activeNetwork.l1ChainId, pendingBridge)
          .then((allCredentials) => {
            if (cancelled) return;
            dispatch({ type: "L1_CONFIRMED", allCredentials });
          })
          .catch((err) => {
            if (!cancelled) dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "L1 resume failed" });
          });
        break;
      }

      case "waiting-l2-sync": {
        const cancellers: Array<() => void> = [];
        // Poll each credential's message readiness
        bridge.allCredentials.forEach((cred, index) => {
          if (bridge.messagesReady[index]) return; // already ready
          const { cancel } = pollMessageReadiness(
            activeNetwork.aztecNodeUrl,
            cred.messageHash,
            (status) => {
              if (status === "ready") {
                dispatch({
                  type: "MESSAGE_READY",
                  index,
                  recipientChoice: recipientChoiceRef.current,
                  feeJuiceBalance: feeJuiceBalanceRef.current,
                  walletReady: walletReadyRef.current,
                });
              }
            },
          );
          cancellers.push(cancel);
        });
        // If all messages were already ready (restore), re-check wallet
        if (bridge.messagesReady.every(Boolean) && walletReady) {
          dispatch({ type: "WALLET_READY", recipientChoice, feeJuiceBalance });
        }
        cleanup = () => cancellers.forEach((c) => c());
        break;
      }

      case "ready-to-claim": {
        dispatch({ type: "CLAIM_STARTED" });
        break;
      }

      case "claiming": {
        const { allCredentials, claimPath } = bridge;

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

        const claimPromise = (async () => {
          switch (claimPath.kind) {
            case "self":
              return claimSelf(allCredentials[0]);
            case "multiple":
              return claimAll(claimPath.ephemeral, claimPath.others);
            case "for-recipient":
              return claimForRecipient(allCredentials[0], allCredentials[0].recipient);
          }
        })();

        claimPromise
          .then(() => {
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

  useEffect(() => {
    if (bridge.type === "done") { clearSession(); return; }
    if (bridge.type === "idle" || bridge.type === "error") return;

    const session = phaseToSession(bridge, {
      recipientChoice: recipientChoice ?? "self",
      isExternal,
      recipients,
      networkId: activeNetwork.id,
    });
    if (session) saveSession(session);
  }, [bridge, recipientChoice, isExternal, recipients, activeNetwork.id]);

  // ── Effect: Propagate reducer errors ────────────────────────────────
  useEffect(() => {
    if (bridge.type === "error") setError(bridge.message);
  }, [bridge]);

  // ── Effect: Refresh balance after claim ─────────────────────────────
  useEffect(() => {
    if (claimed) refreshFeeJuiceBalance();
  }, [claimed, refreshFeeJuiceBalance]);

  // ── Effect: postMessage to parent iframe ──────────────────────────
  useEffect(() => {
    if (!isIframe) return;
    const msg: Record<string, unknown> = { type: "gregojuice-bridge" };
    switch (bridge.type) {
      case "l1-pending":
        msg.status = "bridging";
        break;
      case "waiting-l2-sync":
        msg.status = "syncing";
        break;
      case "done":
        msg.status = "complete";
        break;
      case "error":
        msg.status = "error";
        msg.error = bridge.message;
        break;
      default:
        return;
    }
    window.parent.postMessage(msg, "*");
  }, [bridge.type, isIframe]);

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
      if (faucetLocked && mintAmountValue != null) {
        const faucetAmount = formatUnits(mintAmountValue, 18);
        setRecipients((prev) => prev.map((r) => ({ ...r, amount: faucetAmount })));
      }
    }
  }, [recipientReady, wizardStep, faucetLocked, mintAmountValue]);

  const recipientPrefilled = !!queryRecipients;

  useEffect(() => {
    if (wizardStep === 3 && recipientReady && (recipientChoice === "self" || recipientPrefilled))
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
      if (!recipients.every((r) => r.address.length >= 10)) { setError("Invalid recipient address"); return; }
      if (!recipients.every((r) => r.amount)) { setError("Please enter an amount for each recipient"); return; }

      // Parse all recipients into { address, amount } with bigint amounts
      const parsedRecipients = recipients.map((r) => ({
        address: r.address,
        amount: parseUnits(r.amount, balance?.decimals ?? 18),
      }));

      if (parsedRecipients.some((r) => r.amount <= 0n)) { setError("Amounts must be greater than 0"); return; }

      const totalAmount = parsedRecipients.reduce((sum, r) => sum + r.amount, 0n);

      if (parsedRecipients.length === 1 && recipientChoice === "self") {
        // Self-claim: single bridge to self
        if (!faucetLocked && balance && totalAmount > balance.balance) {
          setError("Insufficient balance");
          return;
        }
        const result = await bridgeFeeJuice({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          aztecRecipient: parsedRecipients[0].address,
          amount: parsedRecipients[0].amount,
          mint: faucetLocked,
          onStep: onBridgeStep,
          onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
        });
        dispatch({ type: "L1_CONFIRMED", allCredentials: [result] });
      } else if (needsMultiBridge && aztecAddress) {
        // Internal wallet: prepend ephemeral (gas) recipient
        const ephAmount = faucetLocked && mintAmountValue ? mintAmountValue : parseUnits(EPHEMERAL_CLAIM_GAS_FJ, 18);
        const totalNeeded = totalAmount + (faucetLocked ? 0n : ephAmount);
        if (!faucetLocked && balance && totalNeeded > balance.balance) {
          setError(`Insufficient balance. Need ${formatUnits(totalNeeded, balance.decimals)}`);
          return;
        }
        const allCredentials = await bridgeMultiple({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          recipients: [
            { address: aztecAddress.toString(), amount: ephAmount },
            ...parsedRecipients,
          ],
          mint: faucetLocked,
          onStep: onBridgeStep,
          onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
        });
        dispatch({ type: "L1_CONFIRMED", allCredentials });
      } else {
        // External wallet or single non-self recipient: bridge directly
        if (!faucetLocked && balance && totalAmount > balance.balance) {
          setError("Insufficient balance");
          return;
        }
        if (parsedRecipients.length === 1) {
          const result = await bridgeFeeJuice({
            l1RpcUrl: activeNetwork.l1RpcUrl,
            chainId: l1Addresses.l1ChainId,
            addresses: l1Addresses,
            aztecRecipient: parsedRecipients[0].address,
            amount: parsedRecipients[0].amount,
            mint: faucetLocked,
            onStep: onBridgeStep,
            onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
          });
          dispatch({ type: "L1_CONFIRMED", allCredentials: [result] });
        } else {
          const allCredentials = await bridgeMultiple({
            l1RpcUrl: activeNetwork.l1RpcUrl,
            chainId: l1Addresses.l1ChainId,
            addresses: l1Addresses,
            recipients: parsedRecipients,
            mint: faucetLocked,
            onStep: onBridgeStep,
            onPending: (pending) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending }),
          });
          dispatch({ type: "L1_CONFIRMED", allCredentials });
        }
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
    setRecipients([{ address: "", amount: "" }]);
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

  // Keep credentials available even after "done" for the claim summary display
  const liveCredentials =
    bridge.type === "waiting-l2-sync" || bridge.type === "ready-to-claim" ||
    bridge.type === "claiming" || bridge.type === "claim-sent"
      ? bridge.allCredentials : null;
  if (liveCredentials) lastCredentialsRef.current = liveCredentials;
  const allCredentials = liveCredentials ?? lastCredentialsRef.current;

  // For display: the "main" credentials (excluding ephemeral if multi)
  const credentials = allCredentials
    ? (allCredentials.length > 1 ? allCredentials[allCredentials.length - 1] : allCredentials[0])
    : null;

  const messageStatus: "ready" | "pending" | "error" =
    bridge.type === "waiting-l2-sync"
      ? (bridge.messagesReady.every(Boolean) ? "ready" : "pending")
      : bridgeDone ? "ready" : "pending";

  const ephMessageStatus: "ready" | "pending" | "error" =
    bridge.type === "waiting-l2-sync" && bridge.allCredentials.length > 1
      ? (bridge.messagesReady[0] ? "ready" : "pending")
      : "ready";

  const ephemeralCredentials =
    allCredentials && allCredentials.length > 1 ? allCredentials[0] : null;

  const bridgeStep: BridgeStep =
    bridge.type === "l1-pending" ? "waiting-confirmation"
      : bridge.type === "error" ? "error"
      : bridge.type === "idle" ? "idle"
      : "done";

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
    recipientChoice, setRecipientChoice, recipients, setRecipients,
    recipientReady, advanceFromStep3,
    bridgeStep, bridgeStepLabel, allCredentials, credentials, ephemeralCredentials,
    messageStatus, ephMessageStatus, claimed, isClaiming, needsMultiBridge, isBridging,
    bridgeDone, syncDone, step4Desc, handleBridge, handleReset,
    error, setError,
    isIframe, forceEmbedded, recipientPrefilled,
  };
}
