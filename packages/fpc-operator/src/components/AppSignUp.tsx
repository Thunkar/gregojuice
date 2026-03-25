import { useState } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { FunctionSelector } from "@aztec/aztec.js/abi";
import type { SubscriptionFPCContract as SubscriptionFPC } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { signUpApp } from "../services/fpcService";

interface AppSignUpProps {
  fpc: SubscriptionFPC;
  adminAddress: AztecAddress;
  onSignedUp?: () => void;
}

export function AppSignUp({ fpc, adminAddress, onSignedUp }: AppSignUpProps) {
  const [appAddress, setAppAddress] = useState("");
  const [selectorInput, setSelectorInput] = useState("");
  const [configIndex, setConfigIndex] = useState("0");
  const [maxUses, setMaxUses] = useState("1");
  const [maxFee, setMaxFee] = useState("");
  const [maxUsers, setMaxUsers] = useState("16");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(false);

    if (!appAddress || !selectorInput || !maxFee) {
      setError("All fields are required");
      return;
    }

    const maxUsersNum = parseInt(maxUsers);
    if (maxUsersNum < 1 || maxUsersNum > 16) {
      setError("Max users must be between 1 and 16");
      return;
    }

    setSubmitting(true);
    try {
      // Parse selector: accept either "0xabcd1234" hex or "function_name(type,type)" signature
      let selector: FunctionSelector;
      if (selectorInput.startsWith("0x")) {
        selector = FunctionSelector.fromString(selectorInput);
      } else {
        selector = FunctionSelector.fromSignature(selectorInput);
      }

      await signUpApp(fpc, adminAddress, {
        appAddress: AztecAddress.fromString(appAddress),
        selector,
        configIndex: parseInt(configIndex),
        maxUses: parseInt(maxUses),
        maxFee: BigInt(maxFee),
        maxUsers: maxUsersNum,
      });

      setSuccess(true);
      onSignedUp?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Sign Up New App
      </Typography>

      <TextField
        fullWidth
        label="App Contract Address"
        placeholder="0x..."
        value={appAddress}
        onChange={(e) => setAppAddress(e.target.value)}
        sx={{ mb: 2 }}
        size="small"
      />

      <TextField
        fullWidth
        label="Function Selector"
        placeholder='0xabcd1234 or "transfer_in_private(Field,Field)"'
        value={selectorInput}
        onChange={(e) => setSelectorInput(e.target.value)}
        sx={{ mb: 2 }}
        size="small"
        helperText="Hex selector or function signature"
      />

      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <TextField
          label="Config Index"
          type="number"
          value={configIndex}
          onChange={(e) => setConfigIndex(e.target.value)}
          size="small"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Max Uses"
          type="number"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          size="small"
          sx={{ flex: 1 }}
          helperText="Per subscription"
        />
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <TextField
          label="Max Fee (wei)"
          value={maxFee}
          onChange={(e) => setMaxFee(e.target.value)}
          size="small"
          sx={{ flex: 2 }}
          helperText="Max fee per sponsored tx"
        />
        <TextField
          label="Max Users"
          type="number"
          value={maxUsers}
          onChange={(e) => setMaxUsers(e.target.value)}
          size="small"
          sx={{ flex: 1 }}
          helperText="1-16"
        />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          App signed up successfully!
        </Alert>
      )}

      <Button
        fullWidth
        variant="contained"
        onClick={handleSubmit}
        disabled={submitting}
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
  );
}
