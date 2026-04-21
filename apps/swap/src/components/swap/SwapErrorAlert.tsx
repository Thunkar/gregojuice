import { Collapse, Alert } from "@mui/material";
import type { RefObject } from "react";

interface SwapErrorAlertProps {
  error: string | null;
  onDismiss: () => void;
  errorRef?: RefObject<HTMLDivElement>;
}

export function SwapErrorAlert({ error, onDismiss, errorRef }: SwapErrorAlertProps) {
  return (
    <Collapse in={!!error}>
      <Alert
        ref={errorRef}
        severity="error"
        onClose={onDismiss}
        sx={{
          mt: 2,
          backgroundColor: "rgba(211, 47, 47, 0.1)",
          border: "1px solid rgba(211, 47, 47, 0.3)",
          color: "#ff6b6b",
          "& .MuiAlert-icon": {
            color: "#ff6b6b",
          },
        }}
      >
        {error}
      </Alert>
    </Collapse>
  );
}
