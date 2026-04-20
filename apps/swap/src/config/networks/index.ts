/**
 * Swap's per-network config is richer than bridge/fpc-operator — each JSON
 * also carries the addresses of the deployed contracts + the SubscriptionFPC
 * config. Loaded the same way (glob + eager) so adding a new network is just
 * dropping in a new JSON.
 */

export interface SubscriptionFPCConfig {
  /** Address of the SubscriptionFPC contract */
  address: string;
  /** Secret key for registering the FPC in PXE (needed to decrypt slot notes) */
  secretKey: string;
  /** Map of contractAddress → { functionSelector → configIndex } */
  functions: Record<string, Record<string, number>>;
}

export interface NetworkConfig {
  id: string;
  nodeUrl: string;
  chainId: string;
  rollupVersion: string;
  contracts: {
    gregoCoin: string;
    gregoCoinPremium: string;
    amm: string;
    liquidityToken: string;
    pop: string;
    sponsoredFPC: string;
    salt: string;
  };
  deployer: { address: string };
  deployedAt: string;
  /** Subscription-based FPC for sponsored transactions (operator-managed) */
  subscriptionFPC?: SubscriptionFPCConfig;
}

const modules = import.meta.glob<{ default: NetworkConfig }>("./*.json", { eager: true });

const NETWORKS: NetworkConfig[] = Object.values(modules)
  .map((m) => m.default)
  .filter((n) => n && typeof n.id === "string")
  // Local only makes sense in dev; drop it from production bundles.
  .filter((n) => !import.meta.env.PROD || n.id !== "local");

export function getNetworks(): NetworkConfig[] {
  return NETWORKS;
}

export function getDefaultNetwork(): NetworkConfig {
  if (NETWORKS.length === 0) {
    throw new Error(
      'No network configurations found. Run "yarn deploy:local" / "yarn deploy:devnet" first.',
    );
  }
  // Dev prefers local; prod prefers devnet; otherwise whatever's first.
  if (import.meta.env.DEV) {
    const local = NETWORKS.find((n) => n.id === "local");
    if (local) return local;
  }
  return NETWORKS.find((n) => n.id === "devnet") ?? NETWORKS[0];
}

/** @deprecated Use `getNetworks` directly. */
export function initializeNetworks(): NetworkConfig[] {
  return getNetworks();
}

export function getNetworkById(networks: NetworkConfig[], id: string): NetworkConfig | undefined {
  return networks.find((n) => n.id === id);
}
