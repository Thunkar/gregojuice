import { Box, Select, MenuItem, Typography } from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { useNetwork } from "../contexts/NetworkContext";

export function NetworkSwitcher() {
  const { activeNetwork, availableNetworks, switchNetwork } = useNetwork();

  const handleNetworkSelect = (event: SelectChangeEvent<string>) => {
    const networkId = event.target.value;
    if (networkId === activeNetwork.id) return;
    switchNetwork(networkId);
    // Reload to reinitialize wallet with new network
    window.location.reload();
  };

  return (
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
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor:
                    network.id === activeNetwork.id
                      ? "primary.main"
                      : "text.disabled",
                }}
              />
              <Typography variant="body2">{network.name}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
