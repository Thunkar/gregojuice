import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  LinearProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
} from '@mui/material';
import { formatUnits, parseUnits, type Hex } from 'viem';
import { useWallet } from '../contexts/WalletContext';
import { useNetwork } from '../contexts/NetworkContext';
import { useAztecWallet } from '../contexts/AztecWalletContext';
import {
  fetchL1Addresses,
  getFeeJuiceBalance,
  getMintAmount,
  bridgeFeeJuice,
  type L1Addresses,
  type ClaimCredentials,
  type BridgeStep,
} from '../services/bridgeService';
import { ClaimCredentialsDisplay } from './ClaimCredentials';
import { AccountExport } from './AccountExport';

const STEP_LABELS: Record<BridgeStep, string> = {
  idle: '',
  'fetching-addresses': 'Fetching L1 contract addresses...',
  minting: 'Minting fee juice tokens (testnet)...',
  approving: 'Approving token transfer...',
  bridging: 'Depositing to Aztec portal...',
  'waiting-confirmation': 'Waiting for L1 confirmation...',
  'waiting-l2-sync': 'Waiting for L2 message sync...',
  claimable: 'Ready to claim on L2!',
  done: 'Bridge complete!',
  error: 'Error',
};

const STEP_PROGRESS: Record<BridgeStep, number> = {
  idle: 0,
  'fetching-addresses': 10,
  minting: 30,
  approving: 50,
  bridging: 70,
  'waiting-confirmation': 85,
  'waiting-l2-sync': 92,
  claimable: 100,
  done: 100,
  error: 0,
};

type RecipientMode = 'manual' | 'wallet';

export function BridgeForm() {
  const { account, connect } = useWallet();
  const { activeNetwork } = useNetwork();
  const {
    status: aztecStatus,
    address: aztecAddress,
    feeJuiceBalance,
    connectAztecWallet,
    resetAccount,
  } = useAztecWallet();

  const [recipientMode, setRecipientMode] = useState<RecipientMode>('manual');
  const [manualAddress, setManualAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<BridgeStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ClaimCredentials | null>(null);

  // L1 state
  const [l1Addresses, setL1Addresses] = useState<(L1Addresses & { l1ChainId: number }) | null>(null);
  const [balance, setBalance] = useState<{ balance: bigint; formatted: string; decimals: number } | null>(null);
  const [mintAmountValue, setMintAmountValue] = useState<bigint | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

  // Fetch L1 addresses when network changes
  useEffect(() => {
    let cancelled = false;
    setL1Addresses(null);
    setBalance(null);
    setMintAmountValue(null);
    setIsLoadingInfo(true);

    fetchL1Addresses(activeNetwork.aztecNodeUrl)
      .then(addresses => {
        if (cancelled) return;
        setL1Addresses(addresses);
        if (addresses.feeAssetHandler) {
          getMintAmount(activeNetwork.l1RpcUrl, addresses.l1ChainId, addresses.feeAssetHandler)
            .then(amt => { if (!cancelled) setMintAmountValue(amt); })
            .catch(() => {});
        }
      })
      .catch(err => {
        if (!cancelled) setError(`Failed to fetch L1 addresses: ${err.message}`);
      })
      .finally(() => { if (!cancelled) setIsLoadingInfo(false); });

    return () => { cancelled = true; };
  }, [activeNetwork]);

  // Fetch balance when account or addresses change
  const refreshBalance = useCallback(async () => {
    if (!account || !l1Addresses) {
      setBalance(null);
      return;
    }
    try {
      const bal = await getFeeJuiceBalance(
        activeNetwork.l1RpcUrl,
        l1Addresses.l1ChainId,
        l1Addresses.feeJuice,
        account,
      );
      setBalance(bal);
    } catch (err: unknown) {
      console.warn('Failed to fetch fee juice balance:', err);
      setBalance({ balance: 0n, formatted: '0', decimals: 18 });
    }
  }, [account, l1Addresses, activeNetwork]);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  const hasFaucet = !!l1Addresses?.feeAssetHandler;
  const hasBalance = balance != null && balance.balance > 0n;
  // Faucet mode with zero balance: amount is locked to the mint amount
  const faucetLocked = hasFaucet && !hasBalance;

  // Auto-set amount when faucet is locked
  useEffect(() => {
    if (faucetLocked && mintAmountValue != null) {
      setAmount(formatUnits(mintAmountValue, 18));
    }
  }, [faucetLocked, mintAmountValue]);

  // Create Aztec wallet when user selects wallet mode
  useEffect(() => {
    if (recipientMode === 'wallet' && aztecStatus === 'disconnected') {
      connectAztecWallet();
    }
  }, [recipientMode, aztecStatus, connectAztecWallet]);

  // Resolve the effective recipient address
  const effectiveRecipient = recipientMode === 'wallet'
    ? aztecAddress?.toString() ?? ''
    : manualAddress;

  const handleBridge = async () => {
    if (!account || !l1Addresses) return;

    setError(null);
    setCredentials(null);

    try {
      if (!amount) {
        setError('Please enter an amount');
        return;
      }
      const bridgeAmount = parseUnits(amount, balance?.decimals ?? 18);
      if (bridgeAmount <= 0n) {
        setError('Amount must be greater than 0');
        return;
      }
      if (!faucetLocked && balance && bridgeAmount > balance.balance) {
        setError('Insufficient balance');
        return;
      }
      if (!effectiveRecipient || effectiveRecipient.length < 10) {
        setError('Please enter a valid Aztec address');
        return;
      }

      const result = await bridgeFeeJuice({
        l1RpcUrl: activeNetwork.l1RpcUrl,
        chainId: l1Addresses.l1ChainId,
        addresses: l1Addresses,
        aztecRecipient: effectiveRecipient,
        amount: bridgeAmount,
        mint: faucetLocked,
        onStep: setStep,
      });

      setCredentials(result);
      await refreshBalance();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bridge failed';
      setError(msg);
      setStep('error');
    }
  };

  const handleReset = () => {
    setCredentials(null);
    setStep('idle');
    setError(null);
    setAmount('');
  };

  if (credentials) {
    return <ClaimCredentialsDisplay credentials={credentials} onReset={handleReset} />;
  }

  const isBusy = step !== 'idle' && step !== 'done' && step !== 'error';
  const walletReady = recipientMode === 'wallet' && (aztecStatus === 'ready' || aztecStatus === 'deployed');
  const recipientReady = recipientMode === 'manual' ? manualAddress.length >= 10 : walletReady;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Bridge Fee Juice
      </Typography>

      {isLoadingInfo && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Loading network info...
          </Typography>
          <LinearProgress />
        </Box>
      )}

      {hasFaucet && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: 0 }}>
          Testnet mode: tokens will be minted for free via the faucet.
        </Alert>
      )}

      {/* Recipient Mode Toggle */}
      <Typography variant="body2" color="text.secondary" fontWeight={500} sx={{ mb: 1 }}>
        Recipient
      </Typography>
      <ToggleButtonGroup
        value={recipientMode}
        exclusive
        onChange={(_, v) => { if (v) setRecipientMode(v); }}
        disabled={isBusy}
        fullWidth
        sx={{ mb: 2 }}
        size="small"
      >
        <ToggleButton value="manual">Enter Address</ToggleButton>
        <ToggleButton value="wallet">Create New Account</ToggleButton>
      </ToggleButtonGroup>

      {/* Manual address input */}
      {recipientMode === 'manual' && (
        <TextField
          fullWidth
          label="Aztec Recipient Address"
          placeholder="0x..."
          value={manualAddress}
          onChange={e => setManualAddress(e.target.value)}
          disabled={isBusy}
          sx={{ mb: 2 }}
          helperText="The Aztec L2 address that will receive the fee juice"
        />
      )}

      {/* Wallet mode status */}
      {recipientMode === 'wallet' && (
        <Box sx={{ mb: 2 }}>
          {(aztecStatus === 'creating' || aztecStatus === 'loading') && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, border: '1px solid rgba(212, 255, 40, 0.1)' }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                {aztecStatus === 'loading' ? 'Loading account...' : 'Creating account...'}
              </Typography>
            </Box>
          )}
          {(aztecStatus === 'ready' || aztecStatus === 'deployed') && (
            <Box sx={{ p: 2, border: '1px solid rgba(76, 175, 80, 0.3)', backgroundColor: 'rgba(76, 175, 80, 0.05)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={500}>
                  Recipient
                </Typography>
                <Button
                  size="small"
                  onClick={resetAccount}
                  disabled={isBusy}
                  sx={{ fontSize: '0.65rem', color: 'text.secondary', minWidth: 'auto', px: 0.5, py: 0 }}
                >
                  Reset
                </Button>
              </Box>
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', mb: 1 }}
              >
                {aztecAddress?.toString()}
              </Typography>
              {feeJuiceBalance != null && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Fee Juice: <span style={{ color: '#D4FF28' }}>{feeJuiceBalance}</span>
                </Typography>
              )}
              {aztecStatus === 'deployed' && (
                <Typography variant="caption" color="success.main" sx={{ display: 'block', mb: 1 }}>Account deployed</Typography>
              )}
              <AccountExport />
            </Box>
          )}
          {aztecStatus === 'error' && (
            <Alert severity="error" sx={{ borderRadius: 0 }}>Failed to create account</Alert>
          )}
        </Box>
      )}

      {/* Amount */}
      <Box sx={{ mb: 2 }}>
        {/* Balance + MAX row — only show when amount is NOT locked */}
        {!faucetLocked && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {balance
                ? `Balance: ${balance.formatted}`
                : account
                  ? 'Balance: ...'
                  : ''}
            </Typography>
            {hasBalance && (
              <Button
                size="small"
                onClick={() => setAmount(balance!.formatted)}
                disabled={isBusy}
                sx={{
                  minWidth: 'auto',
                  px: 1,
                  py: 0.25,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'primary.main',
                  backgroundColor: 'rgba(212, 255, 40, 0.1)',
                  border: '1px solid',
                  borderColor: 'primary.main',
                  '&:hover': { backgroundColor: 'rgba(212, 255, 40, 0.2)' },
                  '&:disabled': { opacity: 0.5 },
                }}
              >
                MAX
              </Button>
            )}
          </Box>
        )}
        <TextField
          fullWidth
          label="Amount"
          placeholder="0.0"
          value={amount}
          onChange={e => { if (!faucetLocked) setAmount(e.target.value); }}
          disabled={isBusy || faucetLocked}
          type="number"
          helperText={faucetLocked ? 'Fixed faucet amount (testnet)' : undefined}
        />
      </Box>

      {/* Progress */}
      {isBusy && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {STEP_LABELS[step]}
          </Typography>
          <LinearProgress variant="determinate" value={STEP_PROGRESS[step]} />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Action Button */}
      {!account ? (
        <Button fullWidth variant="contained" color="primary" onClick={connect} size="large">
          Connect Wallet
        </Button>
      ) : (
        <Button
          fullWidth
          variant="contained"
          color="primary"
          onClick={handleBridge}
          disabled={isBusy || !l1Addresses || !recipientReady || !amount}
          size="large"
        >
          {isBusy
            ? STEP_LABELS[step]
            : faucetLocked
              ? 'Mint & Bridge'
              : 'Bridge'}
        </Button>
      )}
    </Paper>
  );
}
