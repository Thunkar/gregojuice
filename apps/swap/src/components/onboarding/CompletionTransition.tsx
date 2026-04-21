/**
 * CompletionTransition Component
 * Shows success animation when onboarding completes
 */

import { Box, Typography, Fade } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";

interface CompletionTransitionProps {
  showCheck: boolean;
  showActionIcon: boolean;
  hasPendingSwap: boolean;
}

export function CompletionTransition({
  showCheck,
  showActionIcon,
  hasPendingSwap,
}: CompletionTransitionProps) {
  const pulseAnimation = {
    animation: "pulse 1s ease-in-out infinite",
    "@keyframes pulse": {
      "0%, 100%": {
        opacity: 1,
        transform: "scale(1)",
      },
      "50%": {
        opacity: 0.7,
        transform: "scale(1.1)",
      },
    },
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 6,
        gap: 3,
      }}
    >
      {/* Success Checkmark */}
      <Fade in={showCheck} timeout={500}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <CheckCircleIcon
            sx={{
              color: "primary.main",
              fontSize: 48,
            }}
          />
          <Typography variant="h6" color="text.primary" sx={{ fontWeight: 600 }}>
            Wallet Configured!
          </Typography>
        </Box>
      </Fade>

      {/* Action Icon and Message - only show if swap is pending */}
      {hasPendingSwap && (
        <Fade in={showActionIcon} timeout={500}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <SwapHorizIcon
              sx={{
                color: "secondary.main",
                fontSize: 40,
                ...pulseAnimation,
              }}
            />
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Executing swap...
            </Typography>
          </Box>
        </Fade>
      )}
    </Box>
  );
}
