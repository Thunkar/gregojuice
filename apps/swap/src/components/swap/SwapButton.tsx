import { Button } from "@mui/material";
import type { SubscriptionStatus } from "../../services/contractService";

interface SwapButtonProps {
  onClick: () => void;
  disabled: boolean;
  contractsLoading: boolean;
  hasAmount: boolean;
  subscriptionStatus: SubscriptionStatus;
}

export function SwapButton({
  onClick,
  disabled,
  contractsLoading,
  hasAmount,
  subscriptionStatus,
}: SwapButtonProps) {
  const { kind } = subscriptionStatus;
  const getButtonText = () => {
    if (contractsLoading) return "Loading contracts...";
    if (!hasAmount) return "Enter an amount";
    if (kind === "full" || kind === "depleted") return "Bridge ETH to swap";
    return "Swap";
  };

  return (
    <Button
      fullWidth
      variant="contained"
      size="large"
      disabled={disabled}
      onClick={onClick}
      data-testid="swap-submit"
      sx={{
        mt: 3,
        py: 2,
        fontSize: "1.125rem",
        fontWeight: 600,
        background: "linear-gradient(135deg, #80336A 0%, #9d4d87 100%)",
        color: "#F2EEE1",
        "&:hover": {
          background: "linear-gradient(135deg, #9d4d87 0%, #b35fa0 100%)",
          boxShadow: "0px 4px 20px rgba(128, 51, 106, 0.5)",
        },
        "&:disabled": {
          backgroundColor: "rgba(255, 255, 255, 0.12)",
          color: "rgba(255, 255, 255, 0.3)",
        },
      }}
    >
      {getButtonText()}
    </Button>
  );
}
