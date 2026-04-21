import { Box, Typography, CircularProgress } from "@mui/material";

type ClaimPhase = "claiming" | "verifying";

interface ClaimProgressProps {
  phase: ClaimPhase;
}

const phaseMessages: Record<ClaimPhase, string> = {
  claiming: "Claiming tokens...",
  verifying: "Verifying amount...",
};

export function ClaimProgress({ phase }: ClaimProgressProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 2, justifyContent: "center" }}>
      <CircularProgress size={20} color="primary" />
      <Typography variant="body2" color="text.secondary">
        {phaseMessages[phase]}
      </Typography>
    </Box>
  );
}
