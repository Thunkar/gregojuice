import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  LinearProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  Collapse,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { useAztecWallet } from "../contexts/AztecWalletContext";
import {
  fetchL1Addresses,
  getFeeJuiceBalance,
  getMintAmount,
  bridgeFeeJuice,
  bridgeDouble,
  pollMessageReadiness,
  type L1Addresses,
  type ClaimCredentials,
  type BridgeStep,
  type MessageStatus,
  getAztecNode,
} from "../services/bridgeService";
import { AccountExport } from "./AccountExport";
import { ClaimPanel } from "./ClaimPanel";
import { IconButton, Tooltip } from "@mui/material";
import { WalletManager } from "@aztec/wallet-sdk/manager";
import { Fr } from "@aztec/foundation/curves/bn254";

// ── Step icon ───────────────────────────────────────────────────────

function StepIcon({ status }: { status: "completed" | "active" | "pending" }) {
  if (status === "completed")
    return <CheckCircleIcon sx={{ color: "primary.main", fontSize: 24 }} />;
  if (status === "active")
    return <CircularProgress size={20} sx={{ color: "primary.main" }} />;
  return (
    <RadioButtonUncheckedIcon sx={{ color: "text.disabled", fontSize: 24 }} />
  );
}

// ── Collapsible step row ────────────────────────────────────────────

function StepRow({
  label,
  description,
  status,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  description: string;
  status: "completed" | "active" | "pending";
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const hasContent = !!children;
  return (
    <Box
      sx={{
        opacity: status === "pending" ? 0.4 : 1,
        transition: "opacity 0.3s",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          py: 1,
          px: 0.5,
          cursor: hasContent && status !== "pending" ? "pointer" : "default",
          "&:hover":
            hasContent && status !== "pending"
              ? { backgroundColor: "rgba(212,255,40,0.02)" }
              : undefined,
        }}
        onClick={hasContent && status !== "pending" ? onToggle : undefined}
      >
        <StepIcon status={status} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: status === "active" ? 600 : 400 }}
          >
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
        {hasContent &&
          status !== "pending" &&
          (expanded ? (
            <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          ))}
      </Box>
      {hasContent && (
        <Collapse in={expanded && status !== "pending"}>
          <Box sx={{ pl: 5, pr: 5, pb: 2 }}>{children}</Box>
        </Collapse>
      )}
    </Box>
  );
}

// ── Copy field ──────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={500}>
        {label}
      </Typography>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          backgroundColor: "rgba(0,0,0,0.3)",
          p: 0.75,
          border: "1px solid rgba(212,255,40,0.08)",
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontFamily: "monospace",
            wordBreak: "break-all",
            flex: 1,
            fontSize: "0.7rem",
          }}
        >
          {value}
        </Typography>
        <Tooltip title={copied ? "Copied!" : "Copy"}>
          <IconButton
            size="small"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            sx={{ color: "primary.main", p: 0.25 }}
          >
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

// ── Wizard steps ────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

const BRIDGE_STEP_LABELS: Record<BridgeStep, string> = {
  idle: "",
  "fetching-addresses": "Fetching addresses...",
  minting: "Minting tokens...",
  approving: "Approving...",
  bridging: "Depositing...",
  "waiting-confirmation": "Waiting for L1 confirmation...",
  "waiting-l2-sync": "Waiting for L2 sync...",
  claimable: "Ready to claim!",
  done: "Bridge complete!",
  error: "Error",
};

// ── External wallet connect (for step 2 "I have a wallet") ──────────

function ExternalWalletConnect() {
  const { activeNetwork } = useNetwork();
  const { connectExternalWallet } = useAztecWallet();
  const [discovered, setDiscovered] = useState<
    Array<{ id: string; name: string; provider: unknown }>
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsDiscovering(true);
    (async () => {
      try {
        const node = getAztecNode(activeNetwork.aztecNodeUrl);
        const nodeInfo = await node.getNodeInfo();
        const chainInfo = {
          chainId: Fr.fromString(nodeInfo.l1ChainId.toString()),
          version: Fr.fromString(nodeInfo.rollupVersion.toString()),
        };
        const session = WalletManager.configure({
          extensions: { enabled: true },
        }).getAvailableWallets({
          chainInfo,
          appId: "gregojuice",
          timeout: 5000,
        });
        const wallets: typeof discovered = [];
        for await (const provider of session.wallets) {
          if (cancelled) break;
          wallets.push({ id: provider.id, name: provider.name, provider });
          setDiscovered([...wallets]);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsDiscovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNetwork]);

  const handleConnect = async (provider: unknown) => {
    setIsConnecting(true);
    setErr(null);
    try {
      type P = {
        establishSecureChannel: (appId: string) => Promise<{
          confirm: () => Promise<
            import("@aztec/aztec.js/wallet").Wallet & {
              getAccounts: () => Promise<
                Array<{
                  item: import("@aztec/aztec.js/addresses").AztecAddress;
                }>
              >;
            }
          >;
        }>;
      };
      const p = provider as P;
      const pending = await p.establishSecureChannel("gregojuice");
      const wallet = await pending.confirm();
      const accounts = await wallet.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts available");
      await connectExternalWallet(wallet, accounts[0].item);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  if (isDiscovering) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Discovering wallets...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  if (isConnecting) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Connecting...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box>
      {discovered.length === 0 && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          No wallets found. Make sure your Aztec wallet extension is installed.
        </Alert>
      )}
      {discovered.map((w) => (
        <Button
          key={w.id}
          fullWidth
          variant="outlined"
          color="primary"
          onClick={() => handleConnect(w.provider)}
          sx={{ mb: 1, justifyContent: "flex-start", textTransform: "none" }}
        >
          {w.name}
        </Button>
      ))}
      {err && (
        <Alert severity="error" sx={{ mt: 1, borderRadius: 0 }}>
          {err}
        </Alert>
      )}
    </Box>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────

export function BridgeWizard() {
  const { account, connect } = useWallet();
  const { activeNetwork } = useNetwork();
  const {
    status: aztecStatus,
    address: aztecAddress,
    feeJuiceBalance,
    credentials: accountCreds,
    connectAztecWallet,
    connectExternalWallet,
    deployWithClaim,
    claimForRecipient,
    resetAccount,
    refreshFeeJuiceBalance,
    error: aztecError,
  } = useAztecWallet();

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [expandedStep, setExpandedStep] = useState<WizardStep>(1);
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
  type AztecChoice = "existing" | "new" | null;
  const [aztecChoice, setAztecChoice] = useState<AztecChoice>(null);

  // Step 3: Recipient
  type RecipientChoice = "self" | "other" | null;
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
      ? aztecStatus === "deployed"
      : aztecStatus === "ready" || aztecStatus === "deployed";

  // Auto-advance from step 2 when account is ready
  useEffect(() => {
    if (wizardStep === 2 && aztecAccountReady) {
      setWizardStep(3);
      setExpandedStep(3);
    }
  }, [wizardStep, aztecAccountReady]);

  // ── Step 3: Recipient ─────────────────────────────────────────────

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

  // Is this a dual-bridge scenario? (new account + bridge to someone else)
  const needsDualBridge =
    aztecChoice === "new" &&
    recipientChoice === "other" &&
    aztecStatus !== "deployed";

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
        // Dual bridge: small for ephemeral account gas + main for target
        // When minting: each mint gives a fixed amount, so ephemeral gets one full mint
        // When using balance: ephemeral gets a small gas amount, rest goes to target
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
        });
        setEphemeralCredentials(result.ephemeral);
        setCredentials(result.main);
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
        });
        setCredentials(result);
      }
      await refreshBalance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bridge failed");
      setBridgeStep("error");
    }
  };

  // For dual bridge: deploy ephemeral account with its claim, then claim for target
  const handleDualClaim = async () => {
    if (!ephemeralCredentials || !credentials) return;
    setIsClaiming(true);
    setError(null);
    try {
      await deployWithClaim(ephemeralCredentials);
      await claimForRecipient(credentials, credentials.recipient);
      setClaimed(true);
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
    try {
      await deployWithClaim(credentials);
      setClaimed(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setIsClaiming(false);
    }
  };

  // For third-party claim with an already-funded wallet
  const handleThirdPartyClaim = async () => {
    if (!credentials) return;
    setIsClaiming(true);
    setError(null);
    try {
      await claimForRecipient(credentials, credentials.recipient);
      setClaimed(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleReset = () => {
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
      // Step 4 is "completed" when claim is done
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
    } else if (
      !needsDualBridge &&
      aztecStatus === "deployed" &&
      feeJuiceBalance != null &&
      BigInt(feeJuiceBalance) > 0n
    ) {
      handleThirdPartyClaim();
    }
  }, [
    syncDone,
    claimed,
    isClaiming,
    credentials,
    recipientChoice,
    needsDualBridge,
    aztecStatus,
    feeJuiceBalance,
  ]);

  // Step 4 description
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

  return (
    <Paper sx={{ p: 3 }}>
      {/* Progress bar */}
      <Box sx={{ mb: 2 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(progress, 100)}
          sx={{
            height: 4,
            borderRadius: 2,
            backgroundColor: "rgba(212,255,40,0.1)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "primary.main",
              borderRadius: 2,
            },
          }}
        />
      </Box>

      {/* ══ Step 1: Connect L1 Wallet ══ */}
      <StepRow
        label="Connect L1 Wallet"
        description={
          account
            ? `${(account as string).slice(0, 6)}...${(account as string).slice(-4)}${balance ? ` — FJ: ${balance.formatted}` : ""}`
            : "Connect your Ethereum wallet"
        }
        status={stepStatus(1)}
        expanded={expandedStep === 1}
        onToggle={() => toggle(1)}
      >
        {!account ? (
          <Box>
            {isLoadingInfo && <LinearProgress sx={{ mb: 1 }} />}
            <Button
              fullWidth
              variant="contained"
              color="primary"
              onClick={connect}
            >
              Connect Wallet
            </Button>
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Fee Juice Balance:{" "}
              <span style={{ color: "#D4FF28", fontWeight: 600 }}>
                {balance?.formatted ?? "..."}
              </span>
            </Typography>
            {hasFaucet && (
              <Typography variant="caption" color="text.secondary">
                Testnet faucet available
              </Typography>
            )}
          </Box>
        )}
      </StepRow>

      {/* ══ Step 2: Aztec Account ══ */}
      <StepRow
        label="Aztec Account"
        description={
          aztecAccountReady
            ? `${aztecAddress?.toString().slice(0, 10)}...${aztecStatus === "deployed" ? " (deployed)" : ""}${feeJuiceBalance && BigInt(feeJuiceBalance) > 0n ? ` — FJ: ${feeJuiceBalance}` : ""}`
            : "Do you have an Aztec wallet?"
        }
        status={stepStatus(2)}
        expanded={expandedStep === 2}
        onToggle={() => toggle(2)}
      >
        {!aztecAccountReady ? (
          <Box>
            <ToggleButtonGroup
              value={aztecChoice}
              exclusive
              onChange={(_, v) => {
                if (v) setAztecChoice(v);
              }}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="existing">I Have a Wallet</ToggleButton>
              <ToggleButton value="new">I Need One</ToggleButton>
            </ToggleButtonGroup>

            {aztecChoice === "existing" && <ExternalWalletConnect />}

            {aztecChoice === "new" && (
              <Box>
                {(aztecStatus === "creating" || aztecStatus === "loading") && (
                  <Box sx={{ py: 1 }}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 0.5 }}
                    >
                      Creating account...
                    </Typography>
                    <LinearProgress />
                  </Box>
                )}
                {aztecStatus === "error" && (
                  <Alert severity="error" sx={{ borderRadius: 0 }}>
                    {aztecError || "Failed to create account"}
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        ) : (
          <Box>
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                fontSize: "0.7rem",
                wordBreak: "break-all",
                mb: 1,
              }}
            >
              {aztecAddress?.toString()}
            </Typography>
            {feeJuiceBalance != null && (
              <Typography variant="body2" color="text.secondary">
                Fee Juice:{" "}
                <span style={{ color: "#D4FF28" }}>{feeJuiceBalance}</span>
              </Typography>
            )}
            <AccountExport />
            <Button
              size="small"
              onClick={resetAccount}
              sx={{ mt: 1, fontSize: "0.7rem", color: "text.secondary" }}
            >
              Change Account
            </Button>
          </Box>
        )}
      </StepRow>

      {/* ══ Step 3: Recipient ══ */}
      <StepRow
        label="Recipient"
        description={
          recipientReady
            ? recipientChoice === "self"
              ? "Bridge to myself"
              : `${effectiveRecipient.slice(0, 10)}...`
            : "Who receives the fee juice?"
        }
        status={stepStatus(3)}
        expanded={expandedStep === 3}
        onToggle={() => toggle(3)}
      >
        <ToggleButtonGroup
          value={recipientChoice}
          exclusive
          onChange={(_, v) => {
            if (v) setRecipientChoice(v);
          }}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="self">Bridge to Myself</ToggleButton>
          <ToggleButton value="other">Bridge to Someone Else</ToggleButton>
        </ToggleButtonGroup>

        {recipientChoice === "other" && (
          <TextField
            fullWidth
            label="Aztec Recipient Address"
            placeholder="0x..."
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            sx={{ mb: 2 }}
            helperText="The Aztec L2 address that will receive the fee juice"
          />
        )}

        {recipientChoice === "other" && recipientReady && (
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={advanceFromStep3}
          >
            Continue
          </Button>
        )}
      </StepRow>

      {/* ══ Step 4: Bridge & Claim ══ */}
      <StepRow
        label="Bridge & Claim"
        description={step4Desc}
        status={stepStatus(4)}
        expanded={expandedStep === 4}
        onToggle={() => toggle(4)}
      >
        {/* ── Phase 1: Amount + Bridge ── */}
        {!bridgeDone && (
          <Box>
            <Box sx={{ mb: 2 }}>
              {!faucetLocked && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 0.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    fontWeight={500}
                  >
                    Balance: {balance?.formatted ?? "..."}
                  </Typography>
                  {hasBalance && (
                    <Button
                      size="small"
                      onClick={() => setAmount(balance!.formatted)}
                      sx={{
                        minWidth: "auto",
                        px: 1,
                        py: 0.25,
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "primary.main",
                        backgroundColor: "rgba(212,255,40,0.1)",
                        border: "1px solid",
                        borderColor: "primary.main",
                        "&:hover": { backgroundColor: "rgba(212,255,40,0.2)" },
                      }}
                    >
                      MAX
                    </Button>
                  )}
                </Box>
              )}
              <TextField
                fullWidth
                label="Amount"
                placeholder="0.0"
                value={amount}
                onChange={(e) => {
                  if (!faucetLocked) setAmount(e.target.value);
                }}
                disabled={isBridging || faucetLocked}
                type="number"
                helperText={faucetLocked ? "Fixed faucet amount" : undefined}
              />
            </Box>
            {isBridging ? (
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 0.5 }}
                >
                  {bridgeStepLabel || BRIDGE_STEP_LABELS[bridgeStep]}
                </Typography>
                <LinearProgress />
              </Box>
            ) : (
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={handleBridge}
                disabled={!amount}
              >
                {faucetLocked ? "Mint & Bridge" : "Bridge"}
              </Button>
            )}
          </Box>
        )}

        {/* ── Phase 2+: Post-bridge sub-steps ── */}
        {bridgeDone && (
          <Box>
            {/* Sub-step list */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {/* 4a: L1 Deposit */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CheckCircleIcon sx={{ color: "primary.main", fontSize: 18 }} />
                <Typography variant="body2" fontWeight={500}>
                  L1 deposit confirmed
                </Typography>
              </Box>

              {/* 4b: L2 Sync */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {syncDone ? (
                  <CheckCircleIcon
                    sx={{ color: "primary.main", fontSize: 18 }}
                  />
                ) : (
                  <RadioButtonUncheckedIcon
                    sx={{ color: "text.disabled", fontSize: 18 }}
                  />
                )}
                <Box sx={{ flex: 1 }}>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    color={syncDone ? "text.primary" : "text.secondary"}
                  >
                    L2 message sync
                  </Typography>
                  {!syncDone && messageStatus === "pending" && (
                    <LinearProgress sx={{ mt: 0.5 }} />
                  )}
                  {messageStatus === "error" && (
                    <Typography variant="caption" color="warning.main">
                      Could not verify — check manually
                    </Typography>
                  )}
                </Box>
              </Box>

              {/* 4c: Claim */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {claimed ? (
                  <CheckCircleIcon
                    sx={{ color: "primary.main", fontSize: 18 }}
                  />
                ) : (
                  <RadioButtonUncheckedIcon
                    sx={{
                      color: syncDone ? "text.primary" : "text.disabled",
                      fontSize: 18,
                    }}
                  />
                )}
                <Typography
                  variant="body2"
                  fontWeight={500}
                  color={
                    claimed
                      ? "text.primary"
                      : syncDone
                        ? "text.primary"
                        : "text.disabled"
                  }
                >
                  {claimed
                    ? `Claimed — FJ: ${feeJuiceBalance}`
                    : "Claim fee juice"}
                </Typography>
              </Box>
            </Box>

            {/* Claim credentials (collapsible) */}
            {!claimed && (
              <Box
                sx={{
                  mt: 2,
                  p: 1.5,
                  backgroundColor: "rgba(0,0,0,0.2)",
                  border: "1px solid rgba(212,255,40,0.08)",
                }}
              >
                <CopyField
                  label="Claim Secret"
                  value={credentials!.claimSecret}
                />
                <CopyField
                  label="Message Leaf Index"
                  value={credentials!.messageLeafIndex}
                />
                <CopyField label="Amount" value={credentials!.claimAmount} />
              </Box>
            )}

            {/* Claim action */}
            {!claimed && syncDone && (
              <Box sx={{ mt: 2 }}>
                {isClaiming ? (
                  <Box>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 0.5 }}
                    >
                      Claiming...
                    </Typography>
                    <LinearProgress />
                  </Box>
                ) : recipientChoice === "self" ? (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={handleSelfClaim}
                  >
                    {aztecStatus === "deployed"
                      ? "Claim Fee Juice"
                      : "Deploy & Claim"}
                  </Button>
                ) : needsDualBridge && ephemeralCredentials ? (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={handleDualClaim}
                  >
                    Deploy Account & Claim for Recipient
                  </Button>
                ) : (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={handleThirdPartyClaim}
                  >
                    Claim for Recipient
                  </Button>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Error */}
        {(error || aztecError) && (
          <Alert
            severity="error"
            sx={{ mt: 1, borderRadius: 0 }}
            onClose={() => setError(null)}
          >
            {error || aztecError}
          </Alert>
        )}
      </StepRow>

      {/* Reset */}
      {(bridgeDone || wizardStep > 1) && (
        <Box
          component="button"
          onClick={handleReset}
          sx={{
            mt: 2,
            width: "100%",
            p: 1,
            border: "1px solid rgba(212,255,40,0.2)",
            backgroundColor: "transparent",
            color: "text.secondary",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "0.8rem",
            fontWeight: 600,
            "&:hover": { backgroundColor: "rgba(212,255,40,0.05)" },
          }}
        >
          Start Over
        </Box>
      )}
    </Paper>
  );
}
