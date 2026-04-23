/**
 * Swap's per-network config is richer than bridge/fpc-operator — each JSON
 * also carries the addresses of the deployed contracts + the SubscriptionFPC
 * config. Loaded via glob so adding a new network is just dropping in a new
 * JSON.
 *
 * Network presence is a *build concern*: production deploys delete
 * `local.json` before building, so the bundle only carries real networks.
 * Local dev / e2e leave `local.json` in place and it becomes the default.
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

/**
 * Order of preference: local first (if present), then testnet, then anything
 * else alphabetically. `getDefaultNetwork` returns `NETWORKS[0]`, so this
 * ordering is what picks the default network on first load.
 */
const PREFERRED_ORDER = ["local", "testnet"];

const NETWORKS: NetworkConfig[] = Object.values(modules)
  .map((m) => m.default)
  .filter((n): n is NetworkConfig => !!n && typeof n.id === "string")
  .sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a.id);
    const bi = PREFERRED_ORDER.indexOf(b.id);
    const aw = ai === -1 ? PREFERRED_ORDER.length : ai;
    const bw = bi === -1 ? PREFERRED_ORDER.length : bi;
    return aw - bw || a.id.localeCompare(b.id);
  });

export function getNetworks(): NetworkConfig[] {
  return NETWORKS;
}

export function getDefaultNetwork(): NetworkConfig {
  if (NETWORKS.length === 0) {
    throw new Error(
      'No network configurations found. Run "yarn deploy:local" / "yarn deploy:testnet" first.',
    );
  }
  return NETWORKS[0];
}

/** @deprecated Use `getNetworks` directly. */
export function initializeNetworks(): NetworkConfig[] {
  return getNetworks();
}

export function getNetworkById(networks: NetworkConfig[], id: string): NetworkConfig | undefined {
  return networks.find((n) => n.id === id);
}
