import { useState, useEffect, useCallback } from "react";
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
  type MessageStatus,
} from "../../services/bridgeService";
import { txProgress } from "../../wallet";
import { SESSION_KEY } from "./constants";
import { saveSession, loadSession, clearSession } from "./useBridgeSession";
import type {
  WizardStep,
  AztecChoice,
  RecipientChoice,
  BridgeStep,
  BridgeSession,
  ClaimCredentials,
} from "./types";

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

  // Wizard state — initialize from session if one exists to prevent auto-advance races
  const initialSession = loadSession(activeNetwork.id);
  const hasSession = !!initialSession;
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    hasSession ? (initialSession?.isExternal ? 2 : 4) : 1,
  );
  const [expandedStep, setExpandedStep] = useState<WizardStep>(
    hasSession ? (initialSession?.isExternal ? 2 : 4) : 1,
  );
  const [error, setError] = useState<string | null>(null);

  // Step 1: L1 wallet state
  const [l1Addresses, setL1Addresses] = useState<
    (L1Addresses & { l1ChainId: number }) | null
  >(null);
  const [balance, setBalance] = useState<{
    balance: bigint;
    formatted: string;
    decimals: number;
  } | null>(null);
  const [mintAmountValue, setMintAmountValue] = useState<bigint | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

  // Step 2: Aztec account choice
  const [aztecChoice, setAztecChoice] = useState<AztecChoice>(null);

  // Step 3: Recipient
  const [recipientChoice, setRecipientChoice] = useState<RecipientChoice>(null);
  const [manualAddress, setManualAddress] = useState("");

  // Step 4: Bridge + Claim
  const [amount, setAmount] = useState("");
  const [bridgeStep, setBridgeStep] = useState<BridgeStep>("idle");
  const [bridgeStepLabel, setBridgeStepLabel] = useState("");
  const [credentials, setCredentials] = useState<ClaimCredentials | null>(null);
  const [ephemeralCredentials, setEphemeralCredentials] =
    useState<ClaimCredentials | null>(null);
  const [messageStatus, setMessageStatus] = useState<MessageStatus>("pending");
  const [ephMessageStatus, setEphMessageStatus] =
    useState<MessageStatus>("pending");
  const [claimed, setClaimed] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // Capture tx progress snapshots during claiming so we can restore the toast on refresh.
  useEffect(() => {
    if (!isClaiming) return;
    return txProgress.subscribe((event) => {
      if (event.aztecTxHash && (event.phase === "sending" || event.phase === "mining")) {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          try {
            const session = JSON.parse(raw) as BridgeSession;
            session.txProgressSnapshot = {
              txId: event.txId,
              label: event.label,
              phases: event.phases,
              startTime: event.startTime,
              aztecTxHash: event.aztecTxHash,
            };
            session.phase = "claiming";
            saveSession(session);
          } catch {
            /* ignore */
          }
        }
      }
    });
  }, [isClaiming]);

  // ── Restore session on mount ──────────────────────────────────────
  const [sessionRestored, setSessionRestored] = useState(false);
  useEffect(() => {
    const session = loadSession(activeNetwork.id);
    if (!session) {
      setSessionRestored(true);
      return;
    }

    // Restore state from persisted session.
    // wizardStep/expandedStep are already initialized from the session in useState.
    setRecipientChoice(session.recipientChoice);
    if (session.amount) setAmount(session.amount);
    if (session.recipient) setManualAddress(session.recipient);

    if (session.isExternal) {
      setAztecChoice("existing");
    } else {
      setAztecChoice("new");
    }

    if (session.phase === "l1-pending" && session.l1BridgeParams) {
      // L1 tx was sent but not confirmed — wait for receipt and extract credentials
      setBridgeStep("waiting-confirmation");
      setBridgeStepLabel("Resuming — waiting for L1 confirmation...");
      resumePendingBridge(activeNetwork.l1ChainId, session.l1BridgeParams)
        .then((result) => {
          if ("ephemeral" in result) {
            setEphemeralCredentials(result.ephemeral);
            setCredentials(result.main);
            saveSession({
              ...session,
              phase: "bridged",
              credentials: result.main,
              ephemeralCredentials: result.ephemeral,
            });
          } else {
            setCredentials(result);
            saveSession({
              ...session,
              phase: "bridged",
              credentials: result,
              ephemeralCredentials: null,
            });
          }
          setBridgeStep("done");
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : "Failed to resume L1 bridge",
          );
          setBridgeStep("error");
        });
      setSessionRestored(true);
      return;
    }

    // Phase is "bridged" or "claiming" — credentials are in the session
    setCredentials(session.credentials ?? null);
    setEphemeralCredentials(session.ephemeralCredentials ?? null);

    if (session.txProgressSnapshot) {
      // Claim tx was already sent — the resume effect (keyed on restoredClaimTxHash) handles it
      setIsClaiming(true);
    }
    // If no claimTxHash, the auto-claim effect will re-trigger once L2 messages sync
    // and the wallet is ready.

    setSessionRestored(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume waiting for a claim tx that was already sent (restore only).
  const [restoredClaimTxHash] = useState(() => {
    const s = loadSession(activeNetwork.id);
    return s?.txProgressSnapshot?.aztecTxHash ?? null;
  });
  useEffect(() => {
    if (!restoredClaimTxHash || claimed) return;
    const session = loadSession(activeNetwork.id);
    const snap = session?.txProgressSnapshot;
    const txId = snap?.txId ?? restoredClaimTxHash;
    const label = snap?.label ?? "Claim Fee Juice";
    const phases = snap?.phases ?? [];
    const startTime = snap?.startTime ?? Date.now();

    // Defer the emit so TxNotificationCenter has time to subscribe
    const miningStart = Date.now();
    const emitMining = () =>
      txProgress.emit({
        txId,
        label,
        phase: "mining",
        startTime,
        phaseStartTime: miningStart,
        phases,
        aztecTxHash: restoredClaimTxHash,
      });
    const timer = setTimeout(emitMining, 0);

    waitForAztecTx(activeNetwork.aztecNodeUrl, restoredClaimTxHash)
      .then(() => {
        setClaimed(true);
        clearSession();
        // Append the Mining phase so the completed toast includes it
        const finalPhases = [
          ...phases,
          { name: "Mining", duration: Date.now() - miningStart, color: "#4caf50" },
        ];
        txProgress.emit({
          txId,
          label,
          phase: "complete",
          startTime,
          phaseStartTime: Date.now(),
          phases: finalPhases,
          aztecTxHash: restoredClaimTxHash,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Claim tx failed");
        const finalPhases = [
          ...phases,
          { name: "Mining", duration: Date.now() - miningStart, color: "#4caf50" },
        ];
        txProgress.emit({
          txId,
          label,
          phase: "error",
          startTime,
          phaseStartTime: Date.now(),
          phases: finalPhases,
          error: err instanceof Error ? err.message : "Claim tx failed",
        });
      })
      .finally(() => {
        setIsClaiming(false);
      });
    return () => clearTimeout(timer);
  }, [restoredClaimTxHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh Aztec FJ balance after claim completes
  useEffect(() => {
    if (claimed) refreshFeeJuiceBalance();
  }, [claimed, refreshFeeJuiceBalance]);

  const hasFaucet = !!l1Addresses?.feeAssetHandler;
  const hasBalance = balance != null && balance.balance > 0n;
  const faucetLocked = hasFaucet && !hasBalance;

  // ── Step 1: Fetch L1 info ──────────────────────────────────────────

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
          getMintAmount(
            activeNetwork.l1RpcUrl,
            addresses.l1ChainId,
            addresses.feeAssetHandler,
          )
            .then((amt) => {
              if (!cancelled) setMintAmountValue(amt);
            })
            .catch(() => {});
      })
      .catch((err) => {
        if (!cancelled)
          setError(`Failed to fetch L1 addresses: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeNetwork]);

  const refreshBalance = useCallback(async () => {
    if (!account || !l1Addresses) {
      setBalance(null);
      return;
    }
    try {
      setBalance(
        await getFeeJuiceBalance(
          activeNetwork.l1RpcUrl,
          l1Addresses.l1ChainId,
          l1Addresses.feeJuice,
          account,
        ),
      );
    } catch {
      setBalance({ balance: 0n, formatted: "0", decimals: 18 });
    }
  }, [account, l1Addresses, activeNetwork]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // Auto-advance from step 1 when L1 wallet connected and info loaded
  useEffect(() => {
    if (account && l1Addresses && balance && wizardStep === 1) {
      setWizardStep(2);
      setExpandedStep(2);
    }
  }, [account, l1Addresses, balance, wizardStep]);

  // ── Step 2: Aztec account ─────────────────────────────────────────

  useEffect(() => {
    if (aztecChoice === "new" && aztecStatus === "disconnected")
      connectAztecWallet();
  }, [aztecChoice, aztecStatus, connectAztecWallet]);

  const aztecAccountReady =
    aztecChoice === "existing"
      ? aztecStatus === "funded"
      : aztecStatus === "ready" || aztecStatus === "funded";

  // Auto-advance from step 2 when account is ready
  useEffect(() => {
    if (wizardStep === 2 && aztecAccountReady) {
      setWizardStep(3);
      setExpandedStep(3);
    }
  }, [wizardStep, aztecAccountReady]);

  // ── Step 3: Recipient ─────────────────────────────────────────────

  // Internal (ephemeral) wallets always bridge to someone else
  useEffect(() => {
    if (!isExternal && recipientChoice !== "other") {
      setRecipientChoice("other");
    }
  }, [isExternal, recipientChoice]);

  const effectiveRecipient =
    recipientChoice === "self"
      ? (aztecAddress?.toString() ?? "")
      : manualAddress;

  const recipientReady =
    recipientChoice === "self" ? !!aztecAddress : manualAddress.length >= 10;

  const advanceFromStep3 = useCallback(() => {
    if (recipientReady && wizardStep === 3) {
      setWizardStep(4);
      setExpandedStep(4);
      if (faucetLocked && mintAmountValue != null)
        setAmount(formatUnits(mintAmountValue, 18));
    }
  }, [recipientReady, wizardStep, faucetLocked, mintAmountValue]);

  // Auto-advance when "Bridge to Myself" is selected
  useEffect(() => {
    if (recipientChoice === "self" && recipientReady && wizardStep === 3) {
      advanceFromStep3();
    }
  }, [recipientChoice, recipientReady, wizardStep, advanceFromStep3]);

  // ── Step 4: Bridge & Claim ────────────────────────────────────────

  const needsDualBridge =
    aztecChoice === "new" &&
    recipientChoice === "other" &&
    aztecStatus !== "funded";

  // Poll L2 message readiness for main credentials
  useEffect(() => {
    if (!credentials) return;
    const { cancel } = pollMessageReadiness(
      activeNetwork.aztecNodeUrl,
      credentials.messageHash,
      setMessageStatus,
    );
    return cancel;
  }, [credentials, activeNetwork.aztecNodeUrl]);

  // Poll L2 message readiness for ephemeral credentials
  useEffect(() => {
    if (!ephemeralCredentials) return;
    const { cancel } = pollMessageReadiness(
      activeNetwork.aztecNodeUrl,
      ephemeralCredentials.messageHash,
      setEphMessageStatus,
    );
    return cancel;
  }, [ephemeralCredentials, activeNetwork.aztecNodeUrl]);

  const onBridgeStep = useCallback((step: BridgeStep, label?: string) => {
    setBridgeStep(step);
    if (label) setBridgeStepLabel(label);
  }, []);

  const handleBridge = async () => {
    if (!account || !l1Addresses) return;
    setError(null);
    try {
      if (!amount) {
        setError("Please enter an amount");
        return;
      }
      const bridgeAmount = parseUnits(amount, balance?.decimals ?? 18);
      if (bridgeAmount <= 0n) {
        setError("Amount must be greater than 0");
        return;
      }
      if (!effectiveRecipient || effectiveRecipient.length < 10) {
        setError("Invalid recipient");
        return;
      }

      if (needsDualBridge && aztecAddress) {
        const ephAmount =
          faucetLocked && mintAmountValue
            ? mintAmountValue
            : parseUnits("100", 18);
        const totalNeeded = bridgeAmount + (faucetLocked ? 0n : ephAmount);
        if (!faucetLocked && balance && totalNeeded > balance.balance) {
          setError(
            `Insufficient balance. Need ${formatUnits(totalNeeded, balance.decimals)} (${formatUnits(bridgeAmount, balance.decimals)} for recipient + ${formatUnits(ephAmount, balance.decimals)} for claimer gas)`,
          );
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
          onPending: (pending) =>
            saveSession({
              phase: "l1-pending",
              recipientChoice: recipientChoice ?? "other",
              isExternal,
              amount,
              recipient: effectiveRecipient,
              networkId: activeNetwork.id,
              timestamp: Date.now(),
              l1BridgeParams: pending,
            }),
        });
        setEphemeralCredentials(result.ephemeral);
        setCredentials(result.main);
        saveSession({
          phase: "bridged",
          credentials: result.main,
          ephemeralCredentials: result.ephemeral,
          recipientChoice: recipientChoice ?? "other",
          isExternal,
          networkId: activeNetwork.id,
          timestamp: Date.now(),
        });
      } else {
        // Single bridge
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
          onPending: (pending) =>
            saveSession({
              phase: "l1-pending",
              recipientChoice: recipientChoice ?? "self",
              isExternal,
              amount,
              recipient: effectiveRecipient,
              networkId: activeNetwork.id,
              timestamp: Date.now(),
              l1BridgeParams: pending,
            }),
        });
        setCredentials(result);
        saveSession({
          phase: "bridged",
          credentials: result,
          ephemeralCredentials: null,
          recipientChoice: recipientChoice ?? "self",
          isExternal,
          networkId: activeNetwork.id,
          timestamp: Date.now(),
        });
      }
      await refreshBalance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bridge failed");
      setBridgeStep("error");
    }
  };

  // For dual bridge: claim both the ephemeral account AND the recipient in a single L2 tx
  const handleDualClaim = async () => {
    if (!ephemeralCredentials || !credentials) return;
    setIsClaiming(true);
    setError(null);
    saveSession({
      phase: "claiming",
      credentials,
      ephemeralCredentials,
      recipientChoice: recipientChoice ?? "other",
      networkId: activeNetwork.id,
      timestamp: Date.now(),
    });
    try {
      await claimBoth(ephemeralCredentials, credentials, credentials.recipient);
      setClaimed(true);
      clearSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setIsClaiming(false);
    }
  };

  // For self-claim
  const handleSelfClaim = async () => {
    if (!credentials) return;
    setIsClaiming(true);
    setError(null);
    saveSession({
      phase: "claiming",
      credentials,
      ephemeralCredentials: null,
      recipientChoice: recipientChoice ?? "self",
      networkId: activeNetwork.id,
      timestamp: Date.now(),
    });
    try {
      await claimSelf(credentials);
      setClaimed(true);
      clearSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleReset = () => {
    clearSession();
    setWizardStep(1);
    setExpandedStep(1);
    setCredentials(null);
    setEphemeralCredentials(null);
    setClaimed(false);
    setIsClaiming(false);
    setBridgeStep("idle");
    setBridgeStepLabel("");
    setMessageStatus("pending");
    setEphMessageStatus("pending");
    setAztecChoice(null);
    setRecipientChoice(null);
    setManualAddress("");
    setAmount("");
    setError(null);
  };

  // ── Step status helpers ───────────────────────────────────────────

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

  const isBridging =
    bridgeStep !== "idle" && bridgeStep !== "done" && bridgeStep !== "error";
  const bridgeDone = !!credentials;
  const syncDone =
    messageStatus === "ready" &&
    (!ephemeralCredentials || ephMessageStatus === "ready");

  // Auto-trigger claim when sync is done
  useEffect(() => {
    if (!syncDone || claimed || isClaiming || !credentials) return;

    if (recipientChoice === "self") {
      handleSelfClaim();
    } else if (ephemeralCredentials) {
      handleDualClaim();
    } else if (
      aztecStatus === "funded" &&
      feeJuiceBalance != null &&
      BigInt(feeJuiceBalance) > 0n
    ) {
      (async () => {
        setIsClaiming(true);
        setError(null);
        saveSession({
          phase: "claiming",
          credentials,
          ephemeralCredentials: null,
          recipientChoice: "other",
          isExternal,
          networkId: activeNetwork.id,
          timestamp: Date.now(),
        });
        try {
          await claimForRecipient(credentials, credentials.recipient);
          setClaimed(true);
          clearSession();
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Claim failed");
        } finally {
          setIsClaiming(false);
        }
      })();
    }
  }, [
    syncDone,
    claimed,
    isClaiming,
    credentials,
    recipientChoice,
    ephemeralCredentials,
    aztecStatus,
    feeJuiceBalance,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Contexts
    account,
    connect,
    activeNetwork,
    aztecStatus,
    aztecAddress,
    feeJuiceBalance,
    aztecError,
    isExternal,
    resetAccount,

    // Wizard navigation
    wizardStep,
    expandedStep,
    toggle,
    stepStatus,
    progress,

    // Step 1
    l1Addresses,
    balance,
    isLoadingInfo,
    hasFaucet,
    hasBalance,
    faucetLocked,
    mintAmountValue,

    // Step 2
    aztecChoice,
    setAztecChoice,
    aztecAccountReady,

    // Step 3
    recipientChoice,
    setRecipientChoice,
    manualAddress,
    setManualAddress,
    effectiveRecipient,
    recipientReady,
    advanceFromStep3,

    // Step 4
    amount,
    setAmount,
    bridgeStep,
    bridgeStepLabel,
    credentials,
    ephemeralCredentials,
    messageStatus,
    ephMessageStatus,
    claimed,
    isClaiming,
    needsDualBridge,
    isBridging,
    bridgeDone,
    syncDone,
    step4Desc,
    handleBridge,
    handleReset,

    // Errors
    error,
    setError,
  };
}
