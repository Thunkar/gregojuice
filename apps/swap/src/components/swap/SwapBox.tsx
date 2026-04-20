import { Box, Typography, TextField, Paper, Button } from "@mui/material";

interface SwapBoxProps {
  label: string;
  tokenName: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  usdValue?: number;
  balance?: bigint | null;
  showBalance?: boolean;
  isLoadingBalance?: boolean;
  onMaxClick?: () => void;
  placeholder?: string;
  hasError?: boolean;
  testId?: string;
}

export function SwapBox({
  label,
  tokenName,
  value,
  onChange,
  disabled = false,
  usdValue,
  balance,
  showBalance = false,
  isLoadingBalance = false,
  onMaxClick,
  placeholder = "0.0",
  hasError = false,
  testId,
}: SwapBoxProps) {
  // Format balance: balance is stored as whole units (not wei)
  const formatBalance = (bal: bigint | null | undefined, loading: boolean): string => {
    // If loading, always show "..." regardless of whether we have old data
    if (loading) return "...";
    if (bal === null || bal === undefined) return "0.00";
    return Number(bal).toFixed(2);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Only allow numbers and decimal point
    if (newValue === "" || /^\d*\.?\d*$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <Paper
      elevation={2}
      data-testid={testId}
      data-balance={balance !== null && balance !== undefined ? balance.toString() : ""}
      sx={{
        p: 3,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        border: "1px solid",
        borderColor: hasError ? "rgba(255, 107, 107, 0.5)" : "rgba(212, 255, 40, 0.15)",
        backdropFilter: "blur(10px)",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          borderColor: hasError ? "rgba(255, 107, 107, 0.7)" : "primary.main",
          boxShadow: hasError
            ? "0px 4px 16px rgba(255, 107, 107, 0.25)"
            : "0px 4px 16px rgba(212, 255, 40, 0.25)",
        },
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          {label}
        </Typography>
        {showBalance && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              Balance: {formatBalance(balance, isLoadingBalance)}
            </Typography>
            {onMaxClick &&
              !isLoadingBalance &&
              balance !== null &&
              balance !== undefined &&
              Number(balance) > 0 && (
                <Button
                  size="small"
                  onClick={onMaxClick}
                  disabled={disabled}
                  sx={{
                    minWidth: "auto",
                    px: 1,
                    py: 0.25,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "primary.main",
                    backgroundColor: "rgba(212, 255, 40, 0.1)",
                    border: "1px solid",
                    borderColor: "primary.main",
                    "&:hover": {
                      backgroundColor: "rgba(212, 255, 40, 0.2)",
                    },
                    "&:disabled": {
                      opacity: 0.5,
                    },
                  }}
                >
                  MAX
                </Button>
              )}
          </Box>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <TextField
          fullWidth
          variant="standard"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontSize: "2rem",
                fontWeight: 600,
                color: "text.primary",
                "& input": {
                  padding: 0,
                },
                "&.Mui-disabled": {
                  color: "text.primary",
                  WebkitTextFillColor: "inherit",
                },
              },
            },
            htmlInput: testId ? { "data-testid": `${testId}-input` } : undefined,
          }}
          sx={{
            flex: 1,
          }}
        />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2.5,
            py: 1,
            backgroundColor: "rgba(157, 77, 135, 0.2)",
            borderRadius: "20px",
            border: "1px solid",
            borderColor: "#9d4d87",
            color: "#9d4d87",
          }}
        >
          <Typography
            variant="body1"
            fontWeight={700}
            sx={{ fontSize: "0.9rem", letterSpacing: "0.02em" }}
          >
            {tokenName}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ mt: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary">
          ≈ ${usdValue ? usdValue.toFixed(2) : "0.00"}
        </Typography>
        {hasError && (
          <Typography variant="caption" sx={{ color: "#ff6b6b", fontWeight: 600 }}>
            Exceeds balance
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
