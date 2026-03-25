import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { type NetworkConfig, getNetworks, getDefaultNetwork } from '../config/networks';

interface NetworkContextType {
  activeNetwork: NetworkConfig;
  availableNetworks: NetworkConfig[];
  switchNetwork: (networkId: string) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) throw new Error('useNetwork must be used within a NetworkProvider');
  return context;
}

const STORAGE_KEY = 'gregojuice_network';

export function NetworkProvider({ defaultNetworkId, children }: { defaultNetworkId?: string | null; children: ReactNode }) {
  const networks = getNetworks();

  const [activeNetworkId, setActiveNetworkId] = useState<string>(() => {
    // Query-param override takes precedence
    if (defaultNetworkId && networks.some(n => n.id === defaultNetworkId)) return defaultNetworkId;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && networks.some(n => n.id === stored)) return stored;
    } catch { /* ignore */ }
    return getDefaultNetwork().id;
  });

  const switchNetwork = useCallback((networkId: string) => {
    const network = networks.find(n => n.id === networkId);
    if (!network) return;
    setActiveNetworkId(networkId);
    try { localStorage.setItem(STORAGE_KEY, networkId); } catch { /* ignore */ }
  }, [networks]);

  const activeNetwork = networks.find(n => n.id === activeNetworkId) ?? networks[0];

  return (
    <NetworkContext.Provider value={{ activeNetwork, availableNetworks: networks, switchNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}
