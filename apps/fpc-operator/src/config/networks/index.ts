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

// Normally drop `local` in production builds. The `e2e` vite mode (see CI:
// `vite build --mode e2e`) keeps it so the preview server can still hit
// `aztec start --local-network` over chainId 31337.
const keepLocal = import.meta.env.DEV || import.meta.env.MODE === "e2e";

const NETWORKS: NetworkConfig[] = Object.values(modules)
  .map((m) => m.default)
  .filter((n) => n && typeof n.id === "string")
  .filter((n) => keepLocal || n.id !== "local");

export function getNetworks(): NetworkConfig[] {
  return NETWORKS;
}

export function getDefaultNetwork(): NetworkConfig {
  if (NETWORKS.length === 0) {
    throw new Error(
      "No network configs found under src/config/networks/. Check at least one JSON exists.",
    );
  }
  return NETWORKS.find((n) => n.id === "testnet") ?? NETWORKS[0];
}
