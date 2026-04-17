/**
 * WalletDiscovery Component
 * Shows the embedded wallet option immediately while searching for external wallets
 */

import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  CircularProgress,
} from "@mui/material";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

interface WalletDiscoveryProps {
  onUseEmbedded: () => void;
}

export function WalletDiscovery({ onUseEmbedded }: WalletDiscoveryProps) {
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Choose how to connect:
        </Typography>
      </Box>

      <List sx={{ pt: 0 }}>
        {/* Embedded wallet option — same style as external wallets */}
        <ListItem disablePadding sx={{ mb: 1 }}>
          <ListItemButton
            onClick={onUseEmbedded}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              "&:hover": {
                borderColor: "primary.main",
                backgroundColor: "rgba(212, 255, 40, 0.05)",
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 48 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(212, 255, 40, 0.1)",
                  borderRadius: 1,
                }}
              >
                <RocketLaunchIcon sx={{ fontSize: 20, color: "primary.main" }} />
              </Box>
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography variant="body1" fontWeight={600}>
                  Continue without external wallet
                </Typography>
              }
              secondary={
                <Typography variant="caption" color="text.secondary">
                  Use a built-in wallet for this session
                </Typography>
              }
            />
          </ListItemButton>
        </ListItem>
      </List>

      {/* Discovery indicator */}
      <Box
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 1.5 }}
      >
        <Typography variant="caption" color="text.secondary">
          Looking for external wallets...
        </Typography>
      </Box>
    </>
  );
}
