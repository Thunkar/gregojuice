import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Hex } from 'viem';
import { connectWallet, getConnectedAccount, switchChain } from '../services';
import { useNetwork } from './NetworkContext';

interface WalletContextType {
  account: Hex | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within a WalletProvider');
  return context;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { activeNetwork } = useNetwork();
  const [account, setAccount] = useState<Hex | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for existing connection on mount
  useEffect(() => {
    getConnectedAccount().then(addr => {
      if (addr) setAccount(addr);
    });
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts[0] as Hex ?? null);
    };
    const handleChainChanged = () => {
      // Reload to reset state on chain change
      window.location.reload();
    };
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      await switchChain(activeNetwork.l1ChainId);
      const addr = await connectWallet();
      setAccount(addr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [activeNetwork]);

  const disconnect = useCallback(() => {
    setAccount(null);
  }, []);

  return (
    <WalletContext.Provider value={{ account, isConnecting, error, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
