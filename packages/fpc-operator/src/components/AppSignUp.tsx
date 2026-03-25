import { useState, useMemo } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Contract } from "@aztec/aztec.js/contracts";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { Fr } from "@aztec/aztec.js/fields";
import { formatUnits, parseUnits } from "viem";
import { FunctionSelector as AztecFunctionSelector, type ContractArtifact, type FunctionAbi } from "@aztec/aztec.js/abi";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import type { SubscriptionFPCContract } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { useWallet } from "../contexts/WalletContext";
import { signUpApp } from "../services/fpcService";
import { runCalibration, type CalibrationResult as CalibrationData } from "../services/calibration";
import { FeePricingService } from "../services/fee-pricing";
import { ArtifactUpload } from "./ArtifactUpload";
import { FunctionSelector } from "./FunctionSelector";
import { FunctionArgsForm, getDefaultArgs } from "./FunctionArgsForm";
import { CalibrationResult } from "./CalibrationResult";

const STEPS = [
  "Upload Artifact",
  "Select Function",
  "Register Contract",
  "Function Arguments",
  "Calibrate",
  "Sign Up",
];

interface AppSignUpProps {
  fpc: SubscriptionFPCContract;
  adminAddress: AztecAddress;
  fpcAddress: string;
  onSignedUp?: () => void;
}

export function AppSignUp({ fpc, adminAddress, fpcAddress, onSignedUp }: AppSignUpProps) {
  const { wallet, node, rollupAddress, l1ChainId, l1RpcUrl } = useWallet();
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Artifact
  const [artifact, setArtifact] = useState<ContractArtifact | null>(null);

  // Step 2: Function
  const [selectedFunction, setSelectedFunction] = useState<FunctionAbi | null>(null);

  // Step 3: Contract instance
  const [instanceMode, setInstanceMode] = useState<"public" | "compute">("public");
  const [contractAddress, setContractAddress] = useState("");
  const [computeSalt, setComputeSalt] = useState("");
  const [computeDeployer, setComputeDeployer] = useState("");
  const [contractInstance, setContractInstance] = useState<ContractInstanceWithAddress | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  // Step 4: Args
  const [argValues, setArgValues] = useState<string[]>([]);

  // Step 5: Calibration
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationData | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  // Step 6: Sign up
  const [maxFeeFj, setMaxFeeFj] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [maxUsers, setMaxUsers] = useState("16");
  const [configIndex, setConfigIndex] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pricing for USD display
  const pricingService = useMemo(() => {
    const svc = new FeePricingService(l1RpcUrl ?? undefined, l1ChainId ?? undefined);
    if (rollupAddress) svc.init(rollupAddress);
    return svc;
  }, [rollupAddress, l1ChainId, l1RpcUrl]);

  // ── Step handlers ───────────────────────────────────────────────────

  const handleArtifactLoaded = (a: ContractArtifact) => {
    setArtifact(a);
    setSelectedFunction(null);
    setContractInstance(null);
    setCalibrationResult(null);
    setActiveStep(1);
  };

  const handleFunctionSelected = (fn: FunctionAbi) => {
    setSelectedFunction(fn);
    setArgValues(getDefaultArgs(fn));
    setCalibrationResult(null);
    setActiveStep(2);
  };

  const handleRegisterPublic = async () => {
    if (!wallet || !node || !artifact) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const address = AztecAddress.fromString(contractAddress);
      const instance = await node.getContract(address);
      if (!instance) throw new Error("Contract not found on-chain at this address");
      await wallet.registerContract(instance, artifact);
      setContractInstance(instance);
      setActiveStep(3);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  };

  const handleRegisterComputed = async () => {
    if (!wallet || !artifact) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const instance = await getContractInstanceFromInstantiationParams(artifact, {
        salt: new Fr(BigInt(computeSalt || "0")),
        deployer: computeDeployer ? AztecAddress.fromString(computeDeployer) : AztecAddress.ZERO,
      });
      await wallet.registerContract(instance, artifact);
      setContractInstance(instance);
      setContractAddress(instance.address.toString());
      setActiveStep(3);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Failed to compute instance");
    } finally {
      setRegistering(false);
    }
  };

  const handleCalibrate = async () => {
    if (!wallet || !node || !artifact || !contractInstance || !selectedFunction) return;
    setCalibrating(true);
    setCalibrationError(null);
    try {
      const result = await runCalibration({
        adminWallet: wallet,
        adminAddress,
        node,
        fpcAddress: AztecAddress.fromString(fpcAddress),
        artifact,
        contractInstance,
        selectedFunction,
        argValues,
      });
      setCalibrationResult(result);
      setMaxFeeFj(formatUnits(result.maxFee, 18));
      setActiveStep(5);
    } catch (err) {
      setCalibrationError(err instanceof Error ? err.message : "Calibration failed");
    } finally {
      setCalibrating(false);
    }
  };

  const handleSignUp = async () => {
    if (!selectedFunction || !contractInstance) return;
    setSubmitting(true);
    setSubmitError(null);
    setSuccess(false);
    try {
      const selector = await AztecFunctionSelector.fromNameAndParameters(selectedFunction.name, selectedFunction.parameters);
      await signUpApp(fpc, adminAddress, {
        appAddress: contractInstance.address,
        selector,
        configIndex: parseInt(configIndex),
        maxUses: parseInt(maxUses),
        maxFee: parseUnits(maxFeeFj, 18),
        maxUsers: parseInt(maxUsers),
      });
      setSuccess(true);
      onSignedUp?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Box>
      <Stepper activeStep={activeStep} orientation="vertical">
        {/* Step 0: Upload Artifact */}
        <Step>
          <StepLabel>{STEPS[0]}</StepLabel>
          <StepContent>
            {artifact ? (
              <Box>
                <Alert severity="success" sx={{ mb: 1 }}>
                  Loaded: {artifact.name} ({artifact.functions.length} functions)
                </Alert>
                <Button size="small" onClick={() => { setArtifact(null); setActiveStep(0); }}>
                  Change artifact
                </Button>
              </Box>
            ) : (
              <ArtifactUpload onArtifactLoaded={handleArtifactLoaded} />
            )}
          </StepContent>
        </Step>

        {/* Step 1: Select Function */}
        <Step>
          <StepLabel>{STEPS[1]}</StepLabel>
          <StepContent>
            {artifact && (
              <FunctionSelector
                artifact={artifact}
                selectedFunction={selectedFunction}
                onSelect={handleFunctionSelected}
              />
            )}
          </StepContent>
        </Step>

        {/* Step 2: Register Contract */}
        <Step>
          <StepLabel>{STEPS[2]}</StepLabel>
          <StepContent>
            <ToggleButtonGroup
              value={instanceMode}
              exclusive
              onChange={(_, v) => { if (v) setInstanceMode(v); }}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="public">Publicly Deployed</ToggleButton>
              <ToggleButton value="compute">Compute from Params</ToggleButton>
            </ToggleButtonGroup>

            {instanceMode === "public" && (
              <Box>
                <TextField
                  fullWidth
                  label="Contract Address"
                  placeholder="0x..."
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  size="small"
                  sx={{ mb: 2 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  onClick={handleRegisterPublic}
                  disabled={registering || !contractAddress}
                >
                  {registering ? <CircularProgress size={20} /> : "Fetch & Register"}
                </Button>
              </Box>
            )}

            {instanceMode === "compute" && (
              <Box>
                <TextField
                  fullWidth
                  label="Salt"
                  placeholder="0 or 0x..."
                  value={computeSalt}
                  onChange={(e) => setComputeSalt(e.target.value)}
                  size="small"
                  sx={{ mb: 1 }}
                />
                <TextField
                  fullWidth
                  label="Deployer Address"
                  placeholder="0x... (or leave empty for zero)"
                  value={computeDeployer}
                  onChange={(e) => setComputeDeployer(e.target.value)}
                  size="small"
                  sx={{ mb: 2 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  onClick={handleRegisterComputed}
                  disabled={registering}
                >
                  {registering ? <CircularProgress size={20} /> : "Compute & Register"}
                </Button>
              </Box>
            )}

            {registerError && <Alert severity="error" sx={{ mt: 1 }}>{registerError}</Alert>}
            {contractInstance && (
              <Alert severity="success" sx={{ mt: 1 }}>
                Registered: {contractInstance.address.toString().slice(0, 14)}...
              </Alert>
            )}
          </StepContent>
        </Step>

        {/* Step 3: Function Arguments */}
        <Step>
          <StepLabel>{STEPS[3]}</StepLabel>
          <StepContent>
            {selectedFunction && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Pre-filled with zero defaults. Modify if the function needs specific values for accurate gas estimation.
                </Typography>
                <FunctionArgsForm fn={selectedFunction} values={argValues} onChange={setArgValues} />
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => setActiveStep(4)}
                  sx={{ mt: 2 }}
                >
                  Continue
                </Button>
              </>
            )}
          </StepContent>
        </Step>

        {/* Step 4: Calibrate */}
        <Step>
          <StepLabel>{STEPS[4]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Run a calibration transaction to measure gas usage and compute the recommended max fee.
            </Typography>

            {calibrationResult && <CalibrationResult result={calibrationResult} />}
            {calibrationError && <Alert severity="error" sx={{ mt: 1, mb: 1 }}>{calibrationError}</Alert>}

            <Button
              fullWidth
              variant="contained"
              onClick={handleCalibrate}
              disabled={calibrating}
              sx={{ mt: calibrationResult ? 2 : 0 }}
            >
              {calibrating ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                  Calibrating...
                </>
              ) : calibrationResult ? (
                "Re-calibrate"
              ) : (
                "Run Calibration"
              )}
            </Button>
          </StepContent>
        </Step>

        {/* Step 5: Sign Up */}
        <Step>
          <StepLabel>{STEPS[5]}</StepLabel>
          <StepContent>
            <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
              <TextField
                label="Max Fee (FJ)"
                value={maxFeeFj}
                onChange={(e) => setMaxFeeFj(e.target.value)}
                size="small"
                type="number"
                sx={{ flex: 2 }}
              />
              <TextField
                label="Config Index"
                type="number"
                value={configIndex}
                onChange={(e) => setConfigIndex(e.target.value)}
                size="small"
                sx={{ flex: 1 }}
              />
            </Box>
            <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
              <TextField
                label="Uses / subscription"
                type="number"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Users (slots)"
                type="number"
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value)}
                size="small"
                sx={{ flex: 1 }}
                helperText="1–16 per call"
              />
            </Box>

            {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }}>App signed up successfully!</Alert>}

            <Button
              fullWidth
              variant="contained"
              onClick={handleSignUp}
              disabled={submitting || !maxFeeFj}
            >
              {submitting ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                  Signing up...
                </>
              ) : (
                "Sign Up App"
              )}
            </Button>
          </StepContent>
        </Step>
      </Stepper>
    </Box>
  );
}
