import { Box, Typography, LinearProgress, Button } from "@mui/material";

interface Step1L1WalletProps {
  account: string | null;
  isLoadingInfo: boolean;
  balance: { formatted: string } | null;
  hasFaucet: boolean;
  connect: () => void;
}

export function Step1L1Wallet({
  account,
  isLoadingInfo,
  balance,
  hasFaucet,
  connect,
}: Step1L1WalletProps) {
  if (!account) {
    return (
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
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        Fee Juice Balance:{" "}
        <span style={{ fontWeight: 600 }}>
          {balance?.formatted ?? "..."}
        </span>
      </Typography>
      {hasFaucet && (
        <Typography variant="caption" color="text.secondary">
          Testnet faucet available
        </Typography>
      )}
    </Box>
  );
}
