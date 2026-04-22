import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

/**
 * Generic factory for a network context + provider + `useNetwork` hook.
 *
 * Each app plugs in:
 *   - its own `NetworkConfig` shape (the loader returns these as `T`)
 *   - its own localStorage key so apps don't clobber each other's selection
 *   - a loader (typically `getNetworks()` / `getDefaultNetwork()` from the
 *     app's own `config/networks/index.ts`)
 *
 * The factory returns strongly-typed `NetworkProvider` + `useNetwork` so
 * callers keep full access to the app-specific fields (e.g. `contracts`
 * on swap, `aztecNodeUrl` on bridge) without casts.
 */

export interface NetworkLike {
  id: string;
}

export interface NetworkContextValue<T extends NetworkLike> {
  activeNetwork: T;
  availableNetworks: T[];
  switchNetwork: (networkId: string) => void;
}

export interface CreateNetworkContextOptions<T extends NetworkLike> {
  storageKey: string;
  getNetworks: () => T[];
  getDefaultNetwork: () => T;
}

export interface NetworkProviderProps {
  /**
   * If provided AND the id matches an available network, it takes precedence
   * over the localStorage value. Useful for query-param-driven initial state.
   */
  defaultNetworkId?: string | null;
  children: ReactNode;
}

export function createNetworkContext<T extends NetworkLike>(opts: CreateNetworkContextOptions<T>) {
  const { storageKey, getNetworks, getDefaultNetwork } = opts;

  const Context = createContext<NetworkContextValue<T> | undefined>(undefined);

  function useNetwork(): NetworkContextValue<T> {
    const value = useContext(Context);
    if (!value) throw new Error("useNetwork must be used within a NetworkProvider");
    return value;
  }

  function NetworkProvider({ defaultNetworkId, children }: NetworkProviderProps) {
    const networks = useMemo(getNetworks, []);

    const [activeNetworkId, setActiveNetworkId] = useState<string>(() => {
      if (defaultNetworkId && networks.some((n) => n.id === defaultNetworkId)) {
        return defaultNetworkId;
      }
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored && networks.some((n) => n.id === stored)) return stored;
      } catch {
        /* localStorage unavailable */
      }
      return getDefaultNetwork().id;
    });

    const switchNetwork = useCallback(
      (networkId: string) => {
        if (!networks.some((n) => n.id === networkId)) return;
        setActiveNetworkId(networkId);
        try {
          localStorage.setItem(storageKey, networkId);
        } catch {
          /* localStorage unavailable */
        }
      },
      [networks],
    );

    const activeNetwork = useMemo(
      () => networks.find((n) => n.id === activeNetworkId) ?? networks[0],
      [networks, activeNetworkId],
    );

    if (!activeNetwork) {
      throw new Error(
        "createNetworkContext: no networks available — check that at least one JSON exists under config/networks/",
      );
    }

    const value = useMemo<NetworkContextValue<T>>(
      () => ({ activeNetwork, availableNetworks: networks, switchNetwork }),
      [activeNetwork, networks, switchNetwork],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  return { NetworkProvider, useNetwork, Context };
}
