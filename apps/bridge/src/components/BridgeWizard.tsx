import { Box, Paper, LinearProgress, Alert, Button } from "@mui/material";
import { StepRow } from "./wizard/steps/StepRow";
import { Step1L1Wallet } from "./wizard/steps/Step1L1Wallet";
import { Step2AztecAccount } from "./wizard/steps/Step2AztecAccount";
import { Step3Recipient } from "./wizard/steps/Step3Recipient";
import { Step4BridgeClaim } from "./wizard/steps/Step4BridgeClaim";
import { useBridgeWizard } from "./wizard/useBridgeWizard";

export function BridgeWizard() {
  const w = useBridgeWizard();

  return (
    <Paper
      sx={{
        p: 3,
        ...(w.isIframe && { border: "none", background: "transparent", backdropFilter: "none" }),
      }}
    >
      {/* Progress bar */}
      <Box sx={{ mb: 2 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(w.progress, 100)}
          sx={{
            height: 4,
            borderRadius: 2,
            backgroundColor: "rgba(212,255,40,0.1)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "primary.main",
              borderRadius: 2,
            },
          }}
        />
      </Box>

      {/* Step 1: Connect L1 Wallet */}
      <StepRow
        label="Connect L1 Wallet"
        description={w.step1Desc}
        status={w.stepStatus(1)}
        expanded={w.expandedStep === 1}
        onToggle={() => w.toggle(1)}
        testId="bridge-step-l1"
      >
        <Step1L1Wallet {...w.step1Props} />
      </StepRow>

      {/* Step 2: Aztec Account */}
      <StepRow
        label="Aztec Account"
        description={w.step2Desc}
        status={w.stepStatus(2)}
        expanded={w.expandedStep === 2}
        onToggle={() => w.toggle(2)}
        testId="bridge-step-aztec"
      >
        <Step2AztecAccount {...w.step2Props} />
      </StepRow>

      {/* Step 3: Recipient */}
      <StepRow
        label="Recipient"
        description={w.step3Desc}
        status={w.stepStatus(3)}
        expanded={w.expandedStep === 3}
        onToggle={() => w.toggle(3)}
        testId="bridge-step-recipient"
      >
        <Step3Recipient {...w.step3Props} />
      </StepRow>

      {/* Step 4: Bridge & Claim */}
      <StepRow
        label="Bridge & Claim"
        description={w.step4Desc}
        status={w.stepStatus(4)}
        expanded={w.expandedStep === 4}
        onToggle={() => w.toggle(4)}
        testId="bridge-step-bridge"
      >
        <Step4BridgeClaim {...w.step4Props} />

        {/* Error */}
        {w.error && (
          <Alert
            severity="error"
            sx={{ mt: 1, borderRadius: 0 }}
            onClose={w.clearError}
            action={
              w.canRetryClaim ? (
                <Button color="inherit" size="small" onClick={w.retryClaim}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {w.error}
          </Alert>
        )}
      </StepRow>

      {/* Reset */}
      {(w.bridgeDone || w.wizardStep > 1) && (
        <Box
          component="button"
          onClick={w.handleReset}
          disabled={w.bridgeDone && !w.claimed}
          sx={{
            mt: 2,
            width: "100%",
            p: 1,
            border: "1px solid rgba(212,255,40,0.2)",
            backgroundColor: "transparent",
            color: "text.secondary",
            cursor: w.bridgeDone && !w.claimed ? "not-allowed" : "pointer",
            opacity: w.bridgeDone && !w.claimed ? 0.4 : 1,
            fontFamily: "inherit",
            fontSize: "0.8rem",
            fontWeight: 600,
            "&:hover":
              w.bridgeDone && !w.claimed ? {} : { backgroundColor: "rgba(212,255,40,0.05)" },
          }}
        >
          Start Over
        </Box>
      )}
    </Paper>
  );
}
