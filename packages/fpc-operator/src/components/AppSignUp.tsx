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
  IconButton,
  Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { shortAddress } from "@gregojuice/common";
import { Contract } from "@aztec/aztec.js/contracts";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { Fr } from "@aztec/aztec.js/fields";
import { parseUnits } from "viem";
import { FunctionSelector as AztecFunctionSelector, type ContractArtifact, type FunctionAbi } from "@aztec/aztec.js/abi";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import type { SubscriptionFPCContract } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { useWallet } from "../contexts/WalletContext";
import { signUpApp } from "../services/fpcService";
import { runCalibration, retryCalibrationSimulation, CalibrationError, type CalibrationResult as CalibrationData } from "../services/calibration";
import { FeePricingService } from "../services/fee-pricing";
import { ArtifactUpload } from "./ArtifactUpload";
import { FunctionSelector } from "./FunctionSelector";
import { FunctionArgsForm, getDefaultArgs } from "./FunctionArgsForm";
import { CalibrationResult } from "./CalibrationResult";

const STEPS = [
  "Contract Artifact & Address",
  "Select Function",
  "Additional Contracts",
  "Calibrate & Sign Up",
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

  // Extra contract registrations (for contracts called by the sponsored function)
  const [extraContracts, setExtraContracts] = useState<Array<{ address: string; name: string }>>([]);
  const [extraArtifact, setExtraArtifact] = useState<ContractArtifact | null>(null);
  const [extraAddress, setExtraAddress] = useState("");
  const [extraRegistering, setExtraRegistering] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);

  // Step 4: Args
  const [argValues, setArgValues] = useState<string[]>([]);

  // Step 5: Calibration
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationData | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrationIndex, setCalibrationIndex] = useState<number | null>(null);

  // Step 5: Sign up
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
    // Stay on step 0 — user still needs to register the contract address
  };

  const handleFunctionSelected = (fn: FunctionAbi) => {
    setSelectedFunction(fn);
    setArgValues(getDefaultArgs(fn));
    setCalibrationResult(null);
    setCalibrationIndex(null);
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
      setActiveStep(1);
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
      setActiveStep(1);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Failed to compute instance");
    } finally {
      setRegistering(false);
    }
  };

  const handleRegisterExtra = async () => {
    if (!wallet || !node || !extraArtifact || !extraAddress) return;
    setExtraRegistering(true);
    setExtraError(null);
    try {
      const address = AztecAddress.fromString(extraAddress);
      const instance = await node.getContract(address);
      if (!instance) throw new Error("Contract not found on-chain at this address");
      await wallet.registerContract(instance, extraArtifact);
      setExtraContracts((prev) => [...prev, { address: extraAddress, name: extraArtifact.name }]);
      setExtraArtifact(null);
      setExtraAddress("");
    } catch (err) {
      setExtraError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setExtraRegistering(false);
    }
  };

  const removeExtraContract = (index: number) => {
    setExtraContracts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCalibrate = async () => {
    if (!wallet || !node || !artifact || !contractInstance || !selectedFunction) return;
    setCalibrating(true);
    setCalibrationError(null);
    try {
      const baseParams = {
        adminWallet: wallet,
        adminAddress,
        fpcAddress: AztecAddress.fromString(fpcAddress),
        artifact,
        contractInstance,
        selectedFunction,
        argValues,
      };

      const result = calibrationIndex !== null
        ? await retryCalibrationSimulation({ ...baseParams, calibrationIndex })
        : await runCalibration(baseParams);

      setCalibrationResult(result);
      setCalibrationIndex(result.calibrationIndex);
    } catch (err) {
      if (err instanceof CalibrationError) {
        setCalibrationIndex(err.calibrationIndex);
      }
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
      // Reset wizard after a short delay so the success message is visible
      setTimeout(() => {
        setActiveStep(0);
        setArtifact(null);
        setSelectedFunction(null);
        setContractInstance(null);
        setContractAddress("");
        setArgValues([]);
        setCalibrationResult(null);
        setCalibrationIndex(null);
        setCalibrationError(null);
        setMaxFeeFj("");
        setConfigIndex("0");
        setMaxUses("1");
        setMaxUsers("16");
        setExtraContracts([]);
        setSuccess(false);
      }, 3000);
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
        {/* Step 0: Contract Artifact & Address */}
        <Step>
          <StepLabel
            onClick={() => activeStep > 0 && setActiveStep(0)}
            sx={{ cursor: activeStep > 0 ? "pointer" : "default" }}
            optional={activeStep > 0 ? <EditIcon sx={{ fontSize: 14, color: "text.secondary" }} /> : undefined}
          >{STEPS[0]}</StepLabel>
          <StepContent>
            {!artifact ? (
              <ArtifactUpload onArtifactLoaded={handleArtifactLoaded} />
            ) : (
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                  <Chip label={`${artifact.name} (${artifact.functions.length} functions)`} size="small" />
                  <Button size="small" onClick={() => { setArtifact(null); setContractInstance(null); }}>
                    Change
                  </Button>
                </Box>

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
                    Registered: {shortAddress(contractInstance.address.toString())}
                  </Alert>
                )}
              </Box>
            )}
          </StepContent>
        </Step>

        {/* Step 1: Select Function */}
        <Step>
          <StepLabel
            onClick={() => activeStep > 1 && setActiveStep(1)}
            sx={{ cursor: activeStep > 1 ? "pointer" : "default" }}
            optional={activeStep > 1 ? <EditIcon sx={{ fontSize: 14, color: "text.secondary" }} /> : undefined}
          >{STEPS[1]}</StepLabel>
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

        {/* Step 2: Additional Contracts */}
        <Step>
          <StepLabel
            onClick={() => activeStep > 2 && setActiveStep(2)}
            sx={{ cursor: activeStep > 2 ? "pointer" : "default" }}
            optional={activeStep > 2 ? <EditIcon sx={{ fontSize: 14, color: "text.secondary" }} /> : undefined}
          >{STEPS[2]}</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              If the sponsored function calls other contracts, register them here. Otherwise skip this step.
            </Typography>

            {extraContracts.map((ec, i) => (
              <Chip
                key={i}
                label={`${ec.name} (${shortAddress(ec.address)})`}
                onDelete={() => removeExtraContract(i)}
                size="small"
                sx={{ mr: 0.5, mb: 0.5 }}
              />
            ))}

            {!extraArtifact ? (
              <ArtifactUpload onArtifactLoaded={setExtraArtifact} />
            ) : (
              <Box sx={{ mt: 1 }}>
                <Chip label={extraArtifact.name} size="small" sx={{ mb: 1 }} />
                <TextField
                  fullWidth
                  label="Contract Address"
                  placeholder="0x..."
                  value={extraAddress}
                  onChange={(e) => setExtraAddress(e.target.value)}
                  size="small"
                  sx={{ mb: 1 }}
                />
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleRegisterExtra}
                    disabled={extraRegistering || !extraAddress}
                    startIcon={extraRegistering ? <CircularProgress size={14} /> : <AddIcon />}
                  >
                    Register
                  </Button>
                  <Button
                    size="small"
                    onClick={() => { setExtraArtifact(null); setExtraAddress(""); setExtraError(null); }}
                  >
                    Cancel
                  </Button>
                </Box>
                {extraError && <Alert severity="error" sx={{ mt: 1 }}>{extraError}</Alert>}
              </Box>
            )}

            <Button
              fullWidth
              variant="contained"
              onClick={() => setActiveStep(3)}
              sx={{ mt: 2 }}
            >
              Continue
            </Button>
          </StepContent>
        </Step>

        {/* Step 3: Calibrate & Sign Up */}
        <Step>
          <StepLabel>{STEPS[3]}</StepLabel>
          <StepContent>
            {selectedFunction && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Function arguments for gas estimation. Modify and re-run if calibration fails.
                </Typography>
                <FunctionArgsForm fn={selectedFunction} values={argValues} onChange={setArgValues} adminAddress={adminAddress.toString()} />

                {calibrationResult && (
                  <Box sx={{ mt: 2 }}>
                    <CalibrationResult
                      result={calibrationResult}
                      maxFeeFj={maxFeeFj}
                      onMaxFeeChange={setMaxFeeFj}
                      maxUses={parseInt(maxUses) || 1}
                      maxUsers={parseInt(maxUsers) || 1}
                    />
                  </Box>
                )}
                {calibrationError && <Alert severity="error" sx={{ mt: 1 }}>{calibrationError}</Alert>}

                {!calibrationResult ? (
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleCalibrate}
                    disabled={calibrating}
                    sx={{ mt: 2 }}
                  >
                    {calibrating ? (
                      <>
                        <CircularProgress size={20} sx={{ mr: 1 }} />
                        {calibrationIndex !== null ? "Retrying..." : "Calibrating..."}
                      </>
                    ) : calibrationIndex !== null ? (
                      "Retry Calibration"
                    ) : (
                      "Run Calibration"
                    )}
                  </Button>
                ) : (
                  <>
                    {/* Sign-up parameters */}
                    <Box sx={{ display: "flex", gap: 2, mt: 2, mb: 2 }}>
                      <TextField
                        label="Config Index"
                        type="number"
                        value={configIndex}
                        onChange={(e) => setConfigIndex(e.target.value)}
                        size="small"
                        sx={{ flex: 1 }}
                      />
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
                        helperText="1–16"
                      />
                    </Box>

                    {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
                    {success && <Alert severity="success" sx={{ mb: 2 }}>App signed up successfully!</Alert>}

                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        variant="outlined"
                        onClick={handleCalibrate}
                        disabled={calibrating || submitting}
                        sx={{ flex: 1 }}
                      >
                        {calibrating ? (
                          <>
                            <CircularProgress size={20} sx={{ mr: 1 }} />
                            Recalibrating...
                          </>
                        ) : (
                          "Recalibrate"
                        )}
                      </Button>
                      <Button
                        variant="contained"
                        onClick={handleSignUp}
                        disabled={submitting || calibrating || !maxFeeFj}
                        sx={{ flex: 1 }}
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
                    </Box>
                  </>
                )}
              </>
            )}
          </StepContent>
        </Step>
      </Stepper>
    </Box>
  );
}
