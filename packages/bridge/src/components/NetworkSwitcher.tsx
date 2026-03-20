import { Box, Select, MenuItem, type SelectChangeEvent } from '@mui/material';
import { useNetwork } from '../contexts/NetworkContext';

export function NetworkSwitcher() {
  const { activeNetwork, availableNetworks, switchNetwork } = useNetwork();

  if (availableNetworks.length <= 1) return null;

  return (
    <Box sx={{ position: 'fixed', top: 16, left: 16, zIndex: 10 }}>
      <Select
        value={activeNetwork.id}
        onChange={(e: SelectChangeEvent) => switchNetwork(e.target.value)}
        size="small"
        sx={{
          color: 'text.primary',
          fontSize: '0.8rem',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(212, 255, 40, 0.3)',
          },
        }}
      >
        {availableNetworks.map(net => (
          <MenuItem key={net.id} value={net.id}>
            {net.name}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
