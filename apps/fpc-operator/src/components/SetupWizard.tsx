import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Stepper,
  Step,
  StepLabel,
  StepContent,
} from "@mui/material";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { shortAddress } from "@gregojuice/common";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { prepareFPC, deployFPC } from "../services/fpcService";
import { BridgeFunding } from "./BridgeFunding";
import { BackupRestore } from "./BackupRestore";

const STEPS = ["Initialize", "Fund Admin & FPC", "Deploy FPC"];

interface SetupWizardProps {
  onComplete: (fpcAddress: string) => void;
  onFpcAddressComputed?: (fpcAddress: string) => void;
}

export function SetupWizard({ onComplete, onFpcAddressComputed }: SetupWizardProps) {
  const { status, wallet, address, node } = useWallet();
  const { activeNetwork } = useNetwork();
  const [activeStep, setActiveStep] = useState(0);
  const [fpcAddress, setFpcAddress] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? "http://localhost:5173";
  const hasInitRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Once wallet is ready, determine the right starting step
  useEffect(() => {
    if (status !== "ready" || !wallet || !address || !node || hasInitRef.current) return;
    hasInitRef.current = true;

    (async () => {
      try {
        const { fpcAddress: fpcAddr } = await prepareFPC(wallet, address);
        const fpcAddrStr = fpcAddr.toString();
        setFpcAddress(fpcAddrStr);
        onFpcAddressComputed?.(fpcAddrStr);

        // Check if the FPC is actually deployed on-chain (survives reorgs)
        const onChainInstance = await node.getContract(fpcAddr);
        if (onChainInstance) {
          onCompleteRef.current(fpcAddr.toString());
          return;
        }

        // Not deployed — check if addresses have funds to skip the funding step
        const fj = FeeJuiceContract.at(wallet);
        const [adminBal, fpcBal] = await Promise.all([
          fj.methods
            .balance_of_public(address)
            .simulate({ from: address })
            .then((r) => BigInt(r.result.toString())),
          fj.methods
            .balance_of_public(fpcAddr)
            .simulate({ from: address })
            .then((r) => BigInt(r.result.toString())),
        ]);

        if (adminBal > 0n && fpcBal > 0n) {
          setActiveStep(2);
        } else {
          setActiveStep(1);
        }
      } catch (err) {
        console.error("Setup init failed:", err);
        setActiveStep(1);
      }
    })();
  }, [status, wallet, address, node]);

  const handleDeploy = useCallback(async () => {
    if (!wallet || !address) return;
    setDeploying(true);
    setDeployError(null);
    try {
      const { fpcAddress: addr } = await deployFPC(wallet, address);
      onCompleteRef.current(addr.toString());
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }, [wallet, address]);

  const bridgeRecipients =
    address && fpcAddress
      ? [
          { address: address.toString(), amount: "" },
          { address: fpcAddress, amount: "" },
        ]
      : null;

  return (
    <Box data-testid="setup-wizard" data-active-step={activeStep}>
      <Stepper activeStep={activeStep} orientation="vertical">
        {/* Step 0: Initialize wallet + compute FPC address */}
        <Step data-testid="setup-step-init">
          <StepLabel>{STEPS[0]}</StepLabel>
          <StepContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {status === "loading" ? "Creating embedded wallet..." : "Computing FPC address..."}
              </Typography>
            </Box>
            {status === "error" && <Alert severity="error">Failed to initialize wallet</Alert>}
          </StepContent>
        </Step>

        {/* Step 1: Fund admin + FPC together */}
        <Step data-testid="setup-step-fund">
          <StepLabel>{STEPS[1]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Bridge fee juice to fund both your admin account and the FPC contract in a single
              transaction.
            </Typography>
            {bridgeRecipients && (
              <BridgeFunding
                recipients={bridgeRecipients}
                networkId={activeNetwork.id}
                bridgeUrl={bridgeUrl}
                onComplete={() => setActiveStep(2)}
              />
            )}
          </StepContent>
        </Step>

        {/* Step 2: Deploy FPC */}
        <Step data-testid="setup-step-deploy">
          <StepLabel>{STEPS[2]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Deploy the SubscriptionFPC contract on-chain. Your account will be the admin.
            </Typography>
            {deployError && (
              <Alert severity="error" sx={{ mb: 2 }} data-testid="setup-deploy-error">
                {deployError}
              </Alert>
            )}
            <Button
              fullWidth
              variant="contained"
              onClick={handleDeploy}
              disabled={deploying || !wallet}
              data-testid="setup-deploy-fpc"
            >
              {deploying ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                  Deploying...
                </>
              ) : (
                "Deploy FPC"
              )}
            </Button>
          </StepContent>
        </Step>
      </Stepper>

      <BackupRestore mode="import-only" />
    </Box>
  );
}
