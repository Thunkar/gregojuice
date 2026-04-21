import { Box, Typography, CircularProgress } from "@mui/material";
import type { SendPhase } from "../../contexts/send";

interface SendProgressProps {
  phase: SendPhase;
}

const phaseMessages: Record<string, string> = {
  sending: "Sending transaction...",
  generating_link: "Generating claim link...",
};

export function SendProgress({ phase }: SendProgressProps) {
  const message = phaseMessages[phase];
  if (!message) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 2, justifyContent: "center" }}>
      <CircularProgress size={20} color="primary" />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
