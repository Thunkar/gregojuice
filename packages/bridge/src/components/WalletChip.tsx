import { Chip, Box } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useWallet } from '../contexts/WalletContext';

export function WalletChip() {
  const { account, isConnecting, connect, disconnect } = useWallet();

  const label = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : isConnecting
      ? 'Connecting...'
      : 'Connect Wallet';

  return (
    <Box sx={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
      <Chip
        icon={<AccountBalanceWalletIcon />}
        label={label}
        onClick={account ? disconnect : connect}
        color={account ? 'primary' : 'default'}
        variant={account ? 'filled' : 'outlined'}
        sx={{
          fontWeight: 600,
          fontSize: '0.875rem',
          cursor: 'pointer',
          '&:hover': { opacity: 0.85 },
        }}
      />
    </Box>
  );
}
