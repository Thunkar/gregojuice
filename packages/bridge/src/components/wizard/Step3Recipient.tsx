import {
  Box,
  TextField,
  Button,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import type { RecipientChoice } from "./types";

interface Step3RecipientProps {
  isExternal: boolean;
  recipientChoice: RecipientChoice;
  setRecipientChoice: (choice: RecipientChoice) => void;
  manualAddress: string;
  setManualAddress: (address: string) => void;
  recipientReady: boolean;
  advanceFromStep3: () => void;
}

export function Step3Recipient({
  isExternal,
  recipientChoice,
  setRecipientChoice,
  manualAddress,
  setManualAddress,
  recipientReady,
  advanceFromStep3,
}: Step3RecipientProps) {
  if (isExternal) {
    return (
      <>
        <ToggleButtonGroup
          value={recipientChoice}
          exclusive
          onChange={(_, v) => {
            if (v) setRecipientChoice(v);
          }}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="self">Bridge to Myself</ToggleButton>
          <ToggleButton value="other">Bridge to Someone Else</ToggleButton>
        </ToggleButtonGroup>

        {recipientChoice === "other" && (
          <TextField
            fullWidth
            label="Aztec Recipient Address"
            placeholder="0x..."
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            sx={{ mb: 2 }}
            helperText="The Aztec L2 address that will receive the fee juice"
          />
        )}

        {recipientChoice === "other" && recipientReady && (
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={advanceFromStep3}
          >
            Continue
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <TextField
        fullWidth
        label="Aztec Recipient Address"
        placeholder="0x..."
        value={manualAddress}
        onChange={(e) => setManualAddress(e.target.value)}
        sx={{ mb: 2 }}
        helperText="The Aztec L2 address that will receive the fee juice"
      />

      {recipientReady && (
        <Button
          fullWidth
          variant="contained"
          color="primary"
          onClick={advanceFromStep3}
        >
          Continue
        </Button>
      )}
    </>
  );
}
