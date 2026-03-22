import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  LinearProgress,
  Alert,
  Button,
} from "@mui/material";
import { ExternalWalletConnect } from "./ExternalWalletConnect";
import type { AztecChoice } from "./types";

interface Step2AztecAccountProps {
  aztecAccountReady: boolean;
  aztecChoice: AztecChoice;
  setAztecChoice: (choice: AztecChoice) => void;
  aztecStatus: string;
  aztecError: string | null;
  resetAccount: () => Promise<void>;
}

export function Step2AztecAccount({
  aztecAccountReady,
  aztecChoice,
  setAztecChoice,
  aztecStatus,
  aztecError,
  resetAccount,
}: Step2AztecAccountProps) {
  if (!aztecAccountReady) {
    return (
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
          <ToggleButton value="new">Use an Embedded Wallet</ToggleButton>
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
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        Account ready
      </Typography>
      <Button
        size="small"
        onClick={resetAccount}
        sx={{ mt: 1, fontSize: "0.7rem", color: "text.secondary" }}
      >
        Change Account
      </Button>
    </Box>
  );
}
