import type { LocalNetwork } from "./local-network.ts";

/**
 * Deploys the contracts each app needs against a running local-network and
 * writes the resulting address map to a JSON file each app can consume.
 *
 * Scaffolding only. The real implementation will:
 *   1. run each app's deploy script (or a shared one) against `network.nodeUrl`
 *   2. collect returned addresses + salts + metadata
 *   3. write them to `apps/<app>/.e2e/local.json` so the app's dev server
 *      picks them up
 */
export interface DeployedNetwork {
  subscriptionFpc?: string;
  amm?: string;
  gregoCoin?: string;
  gregoCoinPremium?: string;
  proofOfPassword?: string;
  bridge?: string;
}

export async function deployAll(_network: LocalNetwork): Promise<DeployedNetwork> {
  throw new Error("deployAll: not implemented — fill in when tests are added");
}
