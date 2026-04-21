import { useState } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";
import { NetworkSwitcher as CommonNetworkSwitcher } from "@gregojuice/common/ui";
import { useNetwork } from "../contexts/network";
import { useWallet } from "../contexts/wallet";
import { useOnboarding } from "../contexts/onboarding";

interface PendingSwitch {
  nextId: string;
  commit: () => void;
}

export function NetworkSwitcher() {
  const { activeNetwork, availableNetworks } = useNetwork();
  const { disconnectWallet } = useWallet();
  const { resetOnboarding, status: onboardingStatus } = useOnboarding();

  const isOnboarded = onboardingStatus === "completed";

  const [pending, setPending] = useState<PendingSwitch | null>(null);

  const handleConfirm = () => {
    if (!pending) return;
    disconnectWallet();
    resetOnboarding();
    pending.commit();
    setPending(null);
  };

  const handleCancel = () => setPending(null);

  return (
    <>
      <CommonNetworkSwitcher
        useNetwork={useNetwork}
        renderLabel={(n) => n.id}
        onSwitch={(nextId, _current, commit) => {
          // If the user hasn't onboarded yet there's nothing to tear down —
          // commit immediately. Otherwise queue the switch behind a confirm
          // dialog and commit only after the user acknowledges.
          if (!isOnboarded) {
            commit();
            return;
          }
          setPending({ nextId, commit });
        }}
      />

      <Dialog
        open={pending !== null}
        onClose={handleCancel}
        maxWidth="xs"
        fullWidth
        sx={{
          "& .MuiDialog-paper": {
            backgroundColor: "background.paper",
            backgroundImage: "none",
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Switch Network?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Switching networks will disconnect your wallet and clear all state. You'll need to
            reconnect after switching.
          </Typography>
          {pending && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: "rgba(212, 255, 40, 0.05)", borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {activeNetwork.id} → {availableNetworks.find((n) => n.id === pending.nextId)?.id}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCancel} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleConfirm} variant="contained" color="primary">
            Switch Network
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
