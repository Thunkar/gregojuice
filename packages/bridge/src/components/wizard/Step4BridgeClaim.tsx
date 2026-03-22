import { Box, Typography, TextField, Button, LinearProgress } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { BRIDGE_STEP_LABELS } from "./constants";
import type { BridgeStep, MessageStatus } from "./types";

interface Step4BridgeClaimProps {
  // Amount & balance
  amount: string;
  setAmount: (amount: string) => void;
  balance: { formatted: string; decimals: number; balance: bigint } | null;
  faucetLocked: boolean;
  hasBalance: boolean;

  // Bridge state
  bridgeStep: BridgeStep;
  bridgeStepLabel: string;
  isBridging: boolean;
  bridgeDone: boolean;
  handleBridge: () => void;

  // Sync & claim state
  syncDone: boolean;
  messageStatus: MessageStatus;
  claimed: boolean;
  isClaiming: boolean;
  feeJuiceBalance: string | null;
}

export function Step4BridgeClaim({
  amount,
  setAmount,
  balance,
  faucetLocked,
  hasBalance,
  bridgeStep,
  bridgeStepLabel,
  isBridging,
  bridgeDone,
  handleBridge,
  syncDone,
  messageStatus,
  claimed,
  isClaiming,
  feeJuiceBalance,
}: Step4BridgeClaimProps) {
  return (
    <>
      {/* Phase 1: Amount + Bridge */}
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

      {/* Phase 2+: Post-bridge sub-steps */}
      {bridgeDone && (
        <Box>
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

          {/* Claim progress */}
          {!claimed && syncDone && isClaiming && (
            <Box sx={{ mt: 2 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                Claiming...
              </Typography>
              <LinearProgress />
            </Box>
          )}
        </Box>
      )}
    </>
  );
}
