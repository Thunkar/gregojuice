/**
 * Network configs are per-file under this directory. A network only appears
 * in the UI if its JSON exists at build time — `import.meta.glob` + `eager`
 * means the set is fixed when the Vite bundle is produced.
 *
 * Public networks (testnet, devnet, nextnet) are checked in. `local.json` is
 * gitignored and generated per-developer via `scripts/bootstrap-networks.js`
 * or by running the e2e setup chain.
 */

export interface NetworkConfig {
  id: string;
  name: string;
  aztecNodeUrl: string;
  l1RpcUrl: string;
  l1ChainId: number;
}

const modules = import.meta.glob<{ default: NetworkConfig }>("./*.json", { eager: true });

const NETWORKS: NetworkConfig[] = Object.values(modules)
  .map((m) => m.default)
  .filter((n) => n && typeof n.id === "string")
  // In production, exclude the developer-local network — it's never reachable
  // from a deployed build.
  .filter((n) => !import.meta.env.PROD || n.id !== "local");

export function getNetworks(): NetworkConfig[] {
  return NETWORKS;
}

export function getDefaultNetwork(): NetworkConfig {
  if (NETWORKS.length === 0) {
    throw new Error(
      "No network configs found under src/config/networks/. Check at least one JSON exists.",
    );
  }
  // Prefer testnet as the default; fall back to whatever's first.
  return NETWORKS.find((n) => n.id === "testnet") ?? NETWORKS[0];
}
