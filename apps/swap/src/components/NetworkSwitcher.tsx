import { useState } from "react";
import {
  Box,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { useNetwork } from "../contexts/network";
import { useWallet } from "../contexts/wallet";
import { useOnboarding } from "../contexts/onboarding";

export function NetworkSwitcher() {
  const { activeNetwork, availableNetworks, switchNetwork } = useNetwork();
  const { disconnectWallet } = useWallet();
  const { resetOnboarding, status: onboardingStatus } = useOnboarding();

  const isOnboarded = onboardingStatus === "completed";

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<string | null>(null);

  const handleNetworkSelect = (event: SelectChangeEvent<string>) => {
    const networkId = event.target.value;
    if (networkId === activeNetwork.id) return;

    // If user has completed onboarding (external or embedded), show confirmation dialog
    if (isOnboarded) {
      setPendingNetwork(networkId);
      setConfirmOpen(true);
    } else {
      // Not yet onboarded, switch immediately
      switchNetwork(networkId);
    }
  };

  const handleConfirmSwitch = () => {
    if (pendingNetwork) {
      // Disconnect wallet and reset onboarding before switching
      disconnectWallet();
      resetOnboarding();
      switchNetwork(pendingNetwork);
      setConfirmOpen(false);
      setPendingNetwork(null);
    }
  };

  const handleCancelSwitch = () => {
    setConfirmOpen(false);
    setPendingNetwork(null);
  };

  // If only one network is available, don't show the switcher
  if (availableNetworks.length <= 1) {
    return null;
  }

  return (
    <>
      <Box
        sx={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 1000,
        }}
      >
        <Select
          value={activeNetwork.id}
          onChange={handleNetworkSelect}
          size="small"
          sx={{
            backgroundColor: "rgba(18, 18, 28, 0.9)",
            backdropFilter: "blur(10px)",
            color: "text.primary",
            border: "1px solid",
            borderColor: "rgba(212, 255, 40, 0.3)",
            borderRadius: 1,
            minWidth: 140,
            "& .MuiOutlinedInput-notchedOutline": {
              border: "none",
            },
            "&:hover": {
              borderColor: "rgba(212, 255, 40, 0.5)",
            },
            "&.Mui-focused": {
              borderColor: "primary.main",
            },
            "& .MuiSelect-select": {
              py: 1,
              px: 1.5,
            },
          }}
        >
          {availableNetworks.map((network) => (
            <MenuItem key={network.id} value={network.id}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {/* Network indicator dot */}
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor:
                      network.id === activeNetwork.id ? "primary.main" : "text.disabled",
                  }}
                />
                <Typography variant="body2">{network.id}</Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={handleCancelSwitch}
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
          {pendingNetwork && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: "rgba(212, 255, 40, 0.05)", borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {activeNetwork.id} → {availableNetworks.find((n) => n.id === pendingNetwork)?.id}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCancelSwitch} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleConfirmSwitch} variant="contained" color="primary">
            Switch Network
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
