import { useState, useEffect, useRef } from "react";
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
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { prepareFPC, deployFPC, getStoredFPC } from "../services/fpcService";
import { BridgeFunding } from "./BridgeFunding";

const STEPS = ["Initialize", "Fund Admin & FPC", "Deploy FPC"];

interface SetupWizardProps {
  onComplete: (fpcAddress: string) => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { status, wallet, address } = useWallet();
  const { activeNetwork } = useNetwork();
  const [activeStep, setActiveStep] = useState(0);
  const [fpcAddress, setFpcAddress] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? "http://localhost:5173";
  const hasInitRef = useRef(false);

  // Once wallet is ready, compute FPC address and check balances (runs once)
  useEffect(() => {
    if (status !== "ready" || !wallet || !address || hasInitRef.current) return;
    hasInitRef.current = true;

    const stored = getStoredFPC();
    if (stored?.deployed) {
      onComplete(stored.address);
      return;
    }

    (async () => {
      try {
        const { fpcAddress: fpcAddr } = await prepareFPC(wallet, address);
        setFpcAddress(fpcAddr.toString());

        const fj = FeeJuiceContract.at(wallet);
        const [adminBal, fpcBal] = await Promise.all([
          fj.methods.balance_of_public(address).simulate({ from: address }).then((r) => BigInt(r.result.toString())),
          fj.methods.balance_of_public(fpcAddr).simulate({ from: address }).then((r) => BigInt(r.result.toString())),
        ]);

        if (adminBal > 0n && fpcBal > 0n) {
          setActiveStep(2);
        } else {
          setActiveStep(1);
        }
      } catch {
        setActiveStep(1);
      }
    })();
  }, [status, wallet, address, onComplete]);

  const handleDeploy = async () => {
    if (!wallet || !address) return;
    setDeploying(true);
    setDeployError(null);
    try {
      const { fpcAddress: addr } = await deployFPC(wallet, address);
      onComplete(addr.toString());
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const bridgeRecipients = address && fpcAddress
    ? [
        { address: address.toString(), amount: "100" },
        { address: fpcAddress, amount: "100" },
      ]
    : null;

  return (
    <Box>
      <Stepper activeStep={activeStep} orientation="vertical">
        {/* Step 0: Initialize wallet + compute FPC address */}
        <Step>
          <StepLabel>{STEPS[0]}</StepLabel>
          <StepContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {status === "loading" ? "Creating embedded wallet..." : "Computing FPC address..."}
              </Typography>
            </Box>
            {status === "error" && (
              <Alert severity="error">Failed to initialize wallet</Alert>
            )}
          </StepContent>
        </Step>

        {/* Step 1: Fund admin + FPC together */}
        <Step>
          <StepLabel>{STEPS[1]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Bridge fee juice to fund both your admin account and the FPC contract in a single transaction.
            </Typography>
            {address && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontFamily: "monospace" }}>
                Admin: {address.toString().slice(0, 14)}...
              </Typography>
            )}
            {fpcAddress && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2, fontFamily: "monospace" }}>
                FPC: {fpcAddress.slice(0, 14)}...
              </Typography>
            )}
            {bridgeRecipients && (
              <BridgeFunding
                recipients={bridgeRecipients}
                networkId={activeNetwork.id}
                bridgeUrl={bridgeUrl}
                onComplete={() => setActiveStep(2)}
              />
            )}
            <Button
              variant="text"
              size="small"
              onClick={() => setActiveStep(2)}
              sx={{ mt: 1 }}
            >
              Skip (already funded)
            </Button>
          </StepContent>
        </Step>

        {/* Step 2: Deploy FPC */}
        <Step>
          <StepLabel>{STEPS[2]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Deploy the SubscriptionFPC contract on-chain. Your account will be the admin.
            </Typography>
            {deployError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {deployError}
              </Alert>
            )}
            <Button
              fullWidth
              variant="contained"
              onClick={handleDeploy}
              disabled={deploying || !wallet}
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
    </Box>
  );
}
