import { Box, Paper, LinearProgress, Alert } from "@mui/material";
import { formatUnits } from "viem";
import { StepRow } from "./wizard/StepRow";
import { Step1L1Wallet } from "./wizard/Step1L1Wallet";
import { Step2AztecAccount } from "./wizard/Step2AztecAccount";
import { Step3Recipient } from "./wizard/Step3Recipient";
import { Step4BridgeClaim } from "./wizard/Step4BridgeClaim";
import { useBridgeWizard } from "./wizard/useBridgeWizard";

export function BridgeWizard() {
  const w = useBridgeWizard();

  return (
    <Paper sx={{ p: 3, ...(w.isIframe && { border: "none", background: "transparent", backdropFilter: "none" }) }}>
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
        description={
          w.account
            ? `${(w.account as string).slice(0, 6)}...${(w.account as string).slice(-4)}${w.balance ? ` — FJ: ${w.balance.formatted}` : ""}`
            : "Connect your Ethereum wallet"
        }
        status={w.stepStatus(1)}
        expanded={w.expandedStep === 1}
        onToggle={() => w.toggle(1)}
      >
        <Step1L1Wallet
          account={w.account}
          isLoadingInfo={w.isLoadingInfo}
          balance={w.balance}
          hasFaucet={w.hasFaucet}
          connect={w.connect}
        />
      </StepRow>

      {/* Step 2: Aztec Account */}
      <StepRow
        label="Aztec Account"
        description={
          w.aztecAccountReady
            ? `${w.aztecAddress?.toString().slice(0, 10)}...${w.aztecStatus === "funded" ? " (funded)" : ""}${w.feeJuiceBalance && BigInt(w.feeJuiceBalance) > 0n ? ` — ${formatUnits(BigInt(w.feeJuiceBalance), 18)} FJ` : ""}`
            : "Do you have an Aztec wallet?"
        }
        status={w.stepStatus(2)}
        expanded={w.expandedStep === 2}
        onToggle={() => w.toggle(2)}
      >
        <Step2AztecAccount
          aztecAccountReady={w.aztecAccountReady}
          aztecChoice={w.aztecChoice}
          setAztecChoice={w.setAztecChoice}
          aztecStatus={w.aztecStatus}
          aztecError={w.aztecError}
          resetAccount={w.resetAccount}
          forceEmbedded={w.forceEmbedded}
        />
      </StepRow>

      {/* Step 3: Recipient */}
      <StepRow
        label="Recipient"
        description={
          w.recipientReady
            ? w.recipientChoice === "self"
              ? "Bridge to myself"
              : w.recipients.length > 1
                ? `${w.recipients.length} recipients`
                : `${w.recipients[0]?.address.slice(0, 10)}...`
            : "Who receives the fee juice?"
        }
        status={w.stepStatus(3)}
        expanded={w.expandedStep === 3}
        onToggle={() => w.toggle(3)}
      >
        <Step3Recipient
          isExternal={w.isExternal}
          recipientChoice={w.recipientChoice}
          setRecipientChoice={w.setRecipientChoice}
          recipients={w.recipients}
          setRecipients={w.setRecipients}
          recipientReady={w.recipientReady}
          advanceFromStep3={w.advanceFromStep3}
          prefilled={w.recipientPrefilled}
        />
      </StepRow>

      {/* Step 4: Bridge & Claim */}
      <StepRow
        label="Bridge & Claim"
        description={w.step4Desc}
        status={w.stepStatus(4)}
        expanded={w.expandedStep === 4}
        onToggle={() => w.toggle(4)}
      >
        <Step4BridgeClaim
          recipients={w.recipients}
          setRecipients={w.setRecipients}
          allCredentials={w.allCredentials}
          balance={w.balance}
          faucetLocked={w.faucetLocked}
          hasBalance={w.hasBalance}
          bridgeStep={w.bridgeStep}
          bridgeStepLabel={w.bridgeStepLabel}
          isBridging={w.isBridging}
          bridgeDone={w.bridgeDone}
          handleBridge={w.handleBridge}
          syncDone={w.syncDone}
          messageStatus={w.messageStatus}
          claimed={w.claimed}
          isClaiming={w.isClaiming}
        />

        {/* Error */}
        {(w.error || w.aztecError) && (
          <Alert
            severity="error"
            sx={{ mt: 1, borderRadius: 0 }}
            onClose={() => w.setError(null)}
          >
            {w.error || w.aztecError}
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
              w.bridgeDone && !w.claimed
                ? {}
                : { backgroundColor: "rgba(212,255,40,0.05)" },
          }}
        >
          Start Over
        </Box>
      )}
    </Paper>
  );
}
