import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { type Hex } from "viem";
import {
  connectWallet,
  getConnectedAccount,
  switchChain,
  getWalletChainId,
  requestAccountSwitch,
  revokeWalletPermissions,
} from "../services";
import { useNetwork } from "./NetworkContext";

interface WalletContextType {
  account: Hex | null;
  chainId: number | null;
  /** True while connecting or switching chains */
  isConnecting: boolean;
  /** True when the wallet is on the wrong chain */
  wrongChain: boolean;
  error: string | null;
  connect: () => Promise<void>;
  /** Opens the wallet's account picker to switch accounts */
  switchAccount: () => Promise<void>;
  /** Disconnects the wallet (revokes permission if supported) */
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within a WalletProvider");
  return context;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { activeNetwork } = useNetwork();
  const [account, setAccount] = useState<Hex | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedChainId = activeNetwork.l1ChainId;
  const wrongChain = chainId != null && chainId !== expectedChainId;

  // ── Read initial state on mount ────────────────────────────────────
  useEffect(() => {
    getConnectedAccount().then((addr) => {
      if (addr) setAccount(addr);
    });
    getWalletChainId().then((id) => {
      if (id != null) setChainId(id);
    });
  }, []);

  // ── Listen for account/chain changes ───────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount((accounts[0] as Hex) ?? null);
      setError(null);
    };

    const handleChainChanged = (chainIdHex: unknown) => {
      const newChainId = parseInt(chainIdHex as string, 16);
      setChainId(newChainId);
      setError(null);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  // ── Auto-switch chain when wrong ───────────────────────────────────
  useEffect(() => {
    if (!wrongChain || !account) return;
    let cancelled = false;
    setIsConnecting(true);
    switchChain(expectedChainId)
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to switch chain");
      })
      .finally(() => {
        if (!cancelled) setIsConnecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wrongChain, account, expectedChainId]);

  // ── Connect ────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      await switchChain(expectedChainId);
      const addr = await connectWallet();
      setAccount(addr);
      const id = await getWalletChainId();
      if (id != null) setChainId(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }, [expectedChainId]);

  const switchAccount = useCallback(async () => {
    setError(null);
    try {
      const addr = await requestAccountSwitch();
      setAccount(addr);
    } catch (err: unknown) {
      // User rejected or wallet doesn't support it — ignore
      if (err instanceof Error && !err.message.includes("rejected")) {
        setError(err.message);
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await revokeWalletPermissions();
    setAccount(null);
    setChainId(null);
    setError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnecting,
        wrongChain,
        error,
        connect,
        switchAccount,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
