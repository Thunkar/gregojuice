import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { FeeJuiceContract } from '@aztec/aztec.js/protocol';
import { Fr } from '@aztec/foundation/curves/bn254';
import { EmbeddedWallet } from '@gregojuice/embedded-wallet';
import { useNetwork } from './NetworkContext';
import { getAztecNode, type ClaimCredentials, claimFeeJuice, claimAllInSingleTx } from '../services/bridgeService';

type AztecWalletStatus =
  | 'disconnected'
  | 'loading'
  | 'creating'
  | 'connecting'    // connecting external wallet
  | 'ready'         // account registered with PXE, usable immediately
  | 'claiming'      // claiming fee juice
  | 'funded'        // account has fee juice
  | 'error';

interface AztecWalletContextType {
  status: AztecWalletStatus;
  wallet: EmbeddedWallet | null;
  externalWallet: Wallet | null;
  address: AztecAddress | null;
  feeJuiceBalance: string | null;
  error: string | null;
  isExternal: boolean;
  connectAztecWallet: () => Promise<void>;
  connectExternalWallet: (wallet: Wallet, walletAddress: AztecAddress) => Promise<void>;
  claimSelf: (claim: ClaimCredentials) => Promise<void>;
  claimForRecipient: (claim: ClaimCredentials, targetAddress: string) => Promise<void>;
  claimAll: (callerClaim: ClaimCredentials, otherClaims: ClaimCredentials[]) => Promise<void>;
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
  const [feeJuiceBalance, setFeeJuiceBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isExternal = externalWallet !== null;
  const activeWallet: Wallet | null = externalWallet ?? wallet;

  // Guard against concurrent connectAztecWallet calls (StrictMode, re-renders)
  const connectingRef = useRef<Promise<void> | null>(null);

  const initEmbeddedWallet = useCallback(async (): Promise<EmbeddedWallet> => {
    const node = getAztecNode(activeNetwork.aztecNodeUrl);
    return EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  }, [activeNetwork]);

  const refreshFeeJuiceBalance = useCallback(async () => {
    if (!activeWallet || !address) return;
    try {
      const fj = FeeJuiceContract.at(activeWallet);
      const { result } = await fj.methods.balance_of_public(address).simulate({ from: address });
      setFeeJuiceBalance(result.toString());
    } catch {
      setFeeJuiceBalance(null);
    }
  }, [activeWallet, address]);

  useEffect(() => {
    if (activeWallet && address && (status === 'funded' || status === 'ready')) {
      refreshFeeJuiceBalance();
    }
  }, [activeWallet, address, status, refreshFeeJuiceBalance]);

  // Create or load embedded wallet with initializerless account
  const connectAztecWallet = useCallback(async () => {
    // Deduplicate: if already connecting, return the in-flight promise
    if (connectingRef.current) return connectingRef.current;

    const doConnect = async () => {
      setStatus('creating');
      setError(null);
      try {
        const w = await initEmbeddedWallet();

        // Try loading existing stored account, or create a new one
        let accountManager = await w.loadStoredAccount();
        if (!accountManager) {
          accountManager = await w.createInitializerlessAccount();
        }

        setWallet(w);
        setAddress(accountManager.address);
        setStatus('ready');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to create Aztec wallet');
        setStatus('error');
      } finally {
        connectingRef.current = null;
      }
    };

    connectingRef.current = doConnect();
    return connectingRef.current;
  }, [initEmbeddedWallet]);

  // Connect external wallet (from wallet SDK discovery)
  const connectExternalWallet = useCallback(async (w: Wallet, walletAddress: AztecAddress) => {
    setExternalWallet(w);
    setAddress(walletAddress);

    setStatus('funded'); // external wallets are assumed funded
    setError(null);
  }, []);

  // Claim fee juice for this account (self-claim)
  const claimSelf = useCallback(async (claim: ClaimCredentials) => {
    if (!activeWallet || !address) throw new Error('Wallet not connected');
    setStatus('claiming');
    setError(null);
    try {
      await claimFeeJuice(activeWallet, address, claim);
      setStatus('funded');
      refreshFeeJuiceBalance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }, [activeWallet, address, refreshFeeJuiceBalance]);

  // Claim for a third-party target address (caller already has fee juice)
  const claimForRecipient = useCallback(async (claim: ClaimCredentials, targetAddress: string) => {
    if (!activeWallet || !address) throw new Error('No wallet connected');
    setStatus('claiming');
    setError(null);
    try {
      const fj = FeeJuiceContract.at(activeWallet);
      const target = AztecAddress.fromString(targetAddress);
      await fj.methods.claim(
        target,
        BigInt(claim.claimAmount),
        Fr.fromHexString(claim.claimSecret),
        Fr.fromHexString(`0x${BigInt(claim.messageLeafIndex).toString(16).padStart(64, "0")}`),
      ).send({ from: address });
      setStatus('funded');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }, [activeWallet, address]);

  // Claim fee juice for the caller and N other recipients in a single L2 tx
  const claimAll = useCallback(async (callerClaim: ClaimCredentials, otherClaims: ClaimCredentials[]) => {
    if (!activeWallet || !address) throw new Error('No wallet connected');
    setStatus('claiming');
    setError(null);
    try {
      await claimAllInSingleTx(activeWallet, address, callerClaim, otherClaims);
      setStatus('funded');
      refreshFeeJuiceBalance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }, [activeWallet, address, refreshFeeJuiceBalance]);

  const resetAccount = useCallback(async () => {
    if (wallet) {
      try { await wallet.deleteStoredAccount(); } catch { /* ignore */ }
    }
    setWallet(null);
    setExternalWallet(null);
    setAddress(null);

    setFeeJuiceBalance(null);
    setStatus('disconnected');
    setError(null);
  }, [wallet]);

  const disconnect = useCallback(() => {
    setWallet(null);
    setExternalWallet(null);
    setAddress(null);

    setFeeJuiceBalance(null);
    setStatus('disconnected');
    setError(null);
  }, []);

  return (
    <AztecWalletContext.Provider
      value={{
        status, wallet, externalWallet, address, feeJuiceBalance, error, isExternal,
        connectAztecWallet, connectExternalWallet, claimSelf, claimForRecipient, claimAll,
        resetAccount, disconnect, refreshFeeJuiceBalance,
      }}
    >
      {children}
    </AztecWalletContext.Provider>
  );
}
