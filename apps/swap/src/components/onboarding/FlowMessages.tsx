/**
 * FlowMessages Component
 * Shows context-specific messages during onboarding
 */

import { Box, Typography, Alert } from "@mui/material";
import type { OnboardingStatus } from "../../contexts/onboarding";

interface FlowMessagesProps {
  status: OnboardingStatus;
  hasSimulationGrant?: boolean;
  useEmbeddedWallet?: boolean;
}

export function FlowMessages({ status, hasSimulationGrant, useEmbeddedWallet }: FlowMessagesProps) {
  // Show info message during drip registration (when balance is 0)
  if (status === "registering_drip") {
    return (
      <Box sx={{ mt: 3 }}>
        <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Uh oh! You have no GregoCoin balance!
          </Typography>
          {useEmbeddedWallet ? (
            <Typography variant="body2">
              Registering the token faucet. You'll be able to claim free tokens shortly.
            </Typography>
          ) : (
            <Typography variant="body2" component="div">
              <strong>Next steps:</strong>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
                <li>Approve the registration of ProofOfPassword contract in your wallet</li>
                <li>Provide the password to claim your tokens</li>
                <li>Authorize the transaction</li>
              </ol>
            </Typography>
          )}
        </Alert>
      </Box>
    );
  }

  return null;
}
