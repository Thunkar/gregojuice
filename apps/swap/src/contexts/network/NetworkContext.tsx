import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { initializeNetworks, type NetworkConfig } from "../../config/networks";

interface NetworkContextType {
  activeNetwork: NetworkConfig;
  availableNetworks: NetworkConfig[];
  switchNetwork: (networkId: string) => void;
  isLoading: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return context;
}

interface NetworkProviderProps {
  children: ReactNode;
}

const STORAGE_KEY = "gregoswap_network";

export function NetworkProvider({ children }: NetworkProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [availableNetworks, setAvailableNetworks] = useState<NetworkConfig[]>([]);
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null);

  // Initialize networks on mount
  useEffect(() => {
    function loadNetworks() {
      try {
        const networks = initializeNetworks();

        setAvailableNetworks(networks);

        // Set default network
        let defaultNet = "local";
        if (import.meta.env.DEV && networks.some((n) => n.id === "local")) {
          defaultNet = "local";
        } else {
          const devnet = networks.find((n) => n.id === "devnet");
          defaultNet = devnet?.id || networks[0]?.id || "local";
        }

        // Try to load from localStorage, fall back to default
        let initialNetwork = defaultNet;
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored && networks.some((n) => n.id === stored)) {
            initialNetwork = stored;
          }
        } catch {
          // Silently fail - localStorage not available
        }

        setActiveNetworkId(initialNetwork);

        if (networks.length === 0) {
          throw new Error(
            'No network configurations found. Please run "yarn deploy:local" or "yarn deploy:devnet" to deploy contracts first.',
          );
        }

        setIsLoading(false);
      } catch (err) {
        throw err;
      }
    }

    loadNetworks();
  }, []);

  const switchNetwork = useCallback(
    (networkId: string) => {
      const network = availableNetworks.find((n) => n.id === networkId);
      if (!network) {
        return;
      }

      setActiveNetworkId(networkId);

      // Persist to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, networkId);
      } catch {
        // Silently fail - localStorage not available
      }
    },
    [availableNetworks],
  );

  // Don't render anything until networks are loaded
  if (isLoading || availableNetworks.length === 0 || !activeNetworkId) {
    return null; // Or a loading spinner
  }

  // Get the active network config
  const activeNetwork =
    availableNetworks.find((n) => n.id === activeNetworkId) || availableNetworks[0];

  if (!activeNetwork) {
    return null;
  }

  const value: NetworkContextType = {
    activeNetwork,
    availableNetworks,
    switchNetwork,
    isLoading,
  };

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}
