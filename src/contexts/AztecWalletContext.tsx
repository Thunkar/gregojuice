import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { EmbeddedWallet } from '../embedded_wallet';
import { useNetwork } from './NetworkContext';
import { getAztecNode, type ClaimCredentials } from '../services/bridgeService';
import { claimFeeJuiceWithExternalWallet } from '../services/claimService';

type AztecWalletStatus =
  | 'disconnected'
  | 'loading'
  | 'creating'
  | 'connecting'    // connecting external wallet
  | 'ready'         // account exists (not deployed), waiting for claim
  | 'deploying'     // deploying/claiming
  | 'deployed'      // account deployed and funded
  | 'error';

interface AccountCredentials {
  secretKey: string;
  salt: string;
  signingKey: string;
  address: string;
}

interface AztecWalletContextType {
  status: AztecWalletStatus;
  wallet: EmbeddedWallet | null;
  externalWallet: Wallet | null;
  address: AztecAddress | null;
  credentials: AccountCredentials | null;
  feeJuiceBalance: string | null;
  error: string | null;
  isExternal: boolean;
  connectAztecWallet: () => Promise<void>;
  connectExternalWallet: (wallet: Wallet, walletAddress: AztecAddress) => Promise<void>;
  deployWithClaim: (claim: ClaimCredentials) => Promise<void>;
  claimForRecipient: (claim: ClaimCredentials, targetAddress: string) => Promise<void>;
  resetAccount: () => Promise<void>;
  disconnect: () => void;
  refreshFeeJuiceBalance: () => Promise<void>;
}

const AztecWalletContext = createContext<AztecWalletContextType | undefined>(undefined);

export function useAztecWallet() {
  const context = useContext(AztecWalletContext);
  if (!context) throw new Error('useAztecWallet must be used within an AztecWalletProvider');
  return context;
}

export function AztecWalletProvider({ children }: { children: ReactNode }) {
  const { activeNetwork } = useNetwork();
  const [status, setStatus] = useState<AztecWalletStatus>('disconnected');
  const [wallet, setWallet] = useState<EmbeddedWallet | null>(null);
  const [externalWallet, setExternalWallet] = useState<Wallet | null>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [credentials, setCredentials] = useState<AccountCredentials | null>(null);
  const [feeJuiceBalance, setFeeJuiceBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isExternal = externalWallet !== null;
  const activeWallet: Wallet | null = externalWallet ?? wallet;

  const initEmbeddedWallet = useCallback(async (): Promise<EmbeddedWallet> => {
    const node = getAztecNode(activeNetwork.aztecNodeUrl);
    return EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  }, [activeNetwork]);

  const loadAccountState = useCallback(async (w: EmbeddedWallet) => {
    const accountManager = await w.getOrCreateAccount();
    const creds = await w.exportAccountCredentials();
    setWallet(w);
    setAddress(accountManager.address);
    setCredentials(creds);
    if (await w.isAccountDeployed()) {
      setStatus('deployed');
    } else {
      setStatus('ready');
    }
  }, []);

  const refreshFeeJuiceBalance = useCallback(async () => {
    if (!activeWallet || !address) return;
    try {
      const { FeeJuiceContract } = await import('@aztec/aztec.js/protocol');
      const fj = FeeJuiceContract.at(activeWallet);
      const { result } = await fj.methods.balance_of_public(address).simulate({ from: address });
      setFeeJuiceBalance(result.toString());
    } catch {
      setFeeJuiceBalance(null);
    }
  }, [activeWallet, address]);

  useEffect(() => {
    if (activeWallet && address && (status === 'deployed' || status === 'ready')) {
      refreshFeeJuiceBalance();
    }
  }, [activeWallet, address, status, refreshFeeJuiceBalance]);

  // Create embedded wallet
  const connectAztecWallet = useCallback(async () => {
    setStatus('creating');
    setError(null);
    try {
      const w = await initEmbeddedWallet();
      await loadAccountState(w);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create Aztec wallet');
      setStatus('error');
    }
  }, [initEmbeddedWallet, loadAccountState]);

  // Connect external wallet (from wallet SDK discovery)
  const connectExternalWallet = useCallback(async (w: Wallet, walletAddress: AztecAddress) => {
    setExternalWallet(w);
    setAddress(walletAddress);
    setCredentials(null); // no exportable credentials for external wallets
    setStatus('deployed'); // external wallets are always deployed
    setError(null);
  }, []);

  // Deploy embedded account with claim (self-claim)
  const deployWithClaim = useCallback(async (claim: ClaimCredentials) => {
    if (!wallet) throw new Error('Wallet not connected');
    const wasDeployed = await wallet.isAccountDeployed();
    setStatus('deploying');
    setError(null);
    try {
      if (wasDeployed) {
        await wallet.claimFeeJuice(claim);
      } else {
        await wallet.deployAccountWithClaim(claim);
      }
      setStatus('deployed');
      refreshFeeJuiceBalance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }, [wallet, refreshFeeJuiceBalance]);

  // Claim for a third-party target address
  const claimForRecipient = useCallback(async (claim: ClaimCredentials, targetAddress: string) => {
    if (!address) throw new Error('No wallet connected');
    setStatus('deploying');
    setError(null);
    try {
      if (externalWallet) {
        await claimFeeJuiceWithExternalWallet(externalWallet, claim, targetAddress, address.toString());
      } else if (wallet) {
        await wallet.claimFeeJuiceForRecipient(claim, targetAddress);
      } else {
        throw new Error('No wallet connected');
      }
      setStatus('deployed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }, [wallet, externalWallet, address]);

  const resetAccount = useCallback(async () => {
    if (wallet) {
      try { await wallet.deleteStoredAccount(); } catch { /* ignore */ }
    }
    setWallet(null);
    setExternalWallet(null);
    setAddress(null);
    setCredentials(null);
    setFeeJuiceBalance(null);
    setStatus('disconnected');
    setError(null);
  }, [wallet]);

  const disconnect = useCallback(() => {
    setWallet(null);
    setExternalWallet(null);
    setAddress(null);
    setCredentials(null);
    setFeeJuiceBalance(null);
    setStatus('disconnected');
    setError(null);
  }, []);

  return (
    <AztecWalletContext.Provider
      value={{
        status, wallet, externalWallet, address, credentials, feeJuiceBalance, error, isExternal,
        connectAztecWallet, connectExternalWallet, deployWithClaim, claimForRecipient,
        resetAccount, disconnect, refreshFeeJuiceBalance,
      }}
    >
      {children}
    </AztecWalletContext.Provider>
  );
}
