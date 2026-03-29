import {
  Box,
  TextField,
  Button,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import type { Recipient, RecipientChoice } from "../types";
import { MAX_RECIPIENTS } from "../constants";

interface Step3RecipientProps {
  /** Whether to show the "Bridge to Myself" toggle (only for external wallets) */
  canBridgeToSelf: boolean;
  recipientChoice: RecipientChoice;
  setRecipientChoice: (choice: RecipientChoice) => void;
  recipients: Recipient[];
  setRecipients: (r: Recipient[]) => void;
  recipientReady: boolean;
  advanceFromStep3: () => void;
  prefilled?: boolean;
}

function RecipientRows({
  recipients,
  setRecipients,
  readOnly,
}: {
  recipients: Recipient[];
  setRecipients: (r: Recipient[]) => void;
  readOnly?: boolean;
}) {
  const updateAddress = (i: number, address: string) => {
    const updated = [...recipients];
    updated[i] = { ...updated[i], address };
    setRecipients(updated);
  };
  const addRow = () => setRecipients([...recipients, { address: "", amount: "" }]);
  const removeRow = (i: number) => {
    if (recipients.length <= 1) return;
    setRecipients(recipients.filter((_, idx) => idx !== i));
  };

  return (
    <>
      {recipients.map((r, i) => (
        <Box key={i} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}>
          <TextField
            fullWidth
            label={recipients.length > 1 ? `Recipient ${i + 1}` : "Aztec Recipient Address"}
            placeholder="0x..."
            value={r.address}
            onChange={(e) => updateAddress(i, e.target.value)}
            slotProps={readOnly ? { input: { readOnly: true } } : undefined}
            size="small"
            helperText={i === 0 && recipients.length === 1 ? "The Aztec L2 address that will receive the fee juice" : undefined}
          />
          {!readOnly && recipients.length > 1 && (
            <IconButton size="small" onClick={() => removeRow(i)} color="error">
              <RemoveCircleOutlineIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      ))}
      {!readOnly && recipients.length < MAX_RECIPIENTS && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={addRow}
          sx={{ mb: 1 }}
        >
          Add recipient
        </Button>
      )}
    </>
  );
}

export function Step3Recipient({
  canBridgeToSelf,
  recipientChoice,
  setRecipientChoice,
  recipients,
  setRecipients,
  recipientReady,
  advanceFromStep3,
  prefilled,
}: Step3RecipientProps) {
  if (prefilled) {
    return (
      <>
        <RecipientRows recipients={recipients} setRecipients={setRecipients} readOnly />
        {recipientReady && (
          <Button fullWidth variant="contained" color="primary" onClick={advanceFromStep3}>
            Continue
          </Button>
        )}
      </>
    );
  }

  if (canBridgeToSelf) {
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
          <>
            <RecipientRows recipients={recipients} setRecipients={setRecipients} />
            {recipientReady && (
              <Button fullWidth variant="contained" color="primary" onClick={advanceFromStep3}>
                Continue
              </Button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <RecipientRows recipients={recipients} setRecipients={setRecipients} />
      {recipientReady && (
        <Button fullWidth variant="contained" color="primary" onClick={advanceFromStep3}>
          Continue
        </Button>
      )}
    </>
  );
}
