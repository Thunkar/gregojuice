import { ThemeProvider, CssBaseline, Container, Box, Typography } from '@mui/material';
import { theme } from './theme';
import { WalletChip } from './components/WalletChip';
import { NetworkSwitcher } from './components/NetworkSwitcher';
import { BridgeWizard } from './components/BridgeWizard';
import { GregoJuiceLogo } from './components/GregoJuiceLogo';
import { TxNotificationCenter } from './components/TxNotificationCenter';
import { useAztecWallet } from './contexts/AztecWalletContext';

export function App() {
  const { address: aztecAddress } = useAztecWallet();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: 'background.default',
          py: 4,
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'url(/background.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)',
            opacity: 0.6,
            zIndex: 0,
          },
        }}
      >
        <NetworkSwitcher />
        <WalletChip />

        <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 6, mt: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <GregoJuiceLogo height={56} />
            </Box>
            <Typography variant="body1" color="text.secondary">
              Bridge fee juice to any Aztec address
            </Typography>
          </Box>

          {/* Bridge Form */}
          <BridgeWizard />

          {/* Footer */}
          <Box sx={{ textAlign: 'center', mt: 4, mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'rgba(242, 238, 225, 0.4)' }}>
              Bridges $AZTEC from L1 to Aztec L2 via the FeeJuicePortal.
              <br />
              On testnet, tokens are minted for free via the faucet.
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Transaction Progress Toasts (embedded Aztec wallet only) */}
      <TxNotificationCenter account={aztecAddress?.toString()} />
    </ThemeProvider>
  );
}
