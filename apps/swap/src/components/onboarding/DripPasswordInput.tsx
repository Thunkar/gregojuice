/**
 * DripPasswordInput Component
 * Password input form for claiming GregoCoin tokens
 */

import { useState } from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import WaterDropIcon from "@mui/icons-material/WaterDrop";

interface DripPasswordInputProps {
  onSubmit: (password: string) => void;
}

export function DripPasswordInput({ onSubmit }: DripPasswordInputProps) {
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (password) {
      onSubmit(password);
      setPassword("");
    }
  };

  return (
    <Box
      data-testid="drip-password-form"
      sx={{
        mt: 3,
        "@keyframes pulseGlow": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(212, 255, 40, 0.4)",
          },
          "50%": {
            boxShadow: "0 0 20px 5px rgba(212, 255, 40, 0.2)",
          },
        },
        animation: "pulseGlow 2s ease-in-out 3",
        borderRadius: 1,
        p: 2,
        backgroundColor: "rgba(212, 255, 40, 0.03)",
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter the password to claim your free GregoCoin tokens:
      </Typography>

      <TextField
        fullWidth
        type="password"
        label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        sx={{ mb: 2 }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && password) {
            handleSubmit();
          }
        }}
        slotProps={{ htmlInput: { "data-testid": "drip-password-input" } }}
      />

      <Button
        fullWidth
        variant="contained"
        onClick={handleSubmit}
        disabled={!password}
        startIcon={<WaterDropIcon />}
        data-testid="drip-password-submit"
      >
        Continue
      </Button>
    </Box>
  );
}
