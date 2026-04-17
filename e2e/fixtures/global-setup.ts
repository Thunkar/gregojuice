import type { FullConfig } from "@playwright/test";
import { startLocalNetwork, type LocalNetwork } from "./local-network.ts";

/**
 * Scaffolding only: starts `aztec start --local-network` and stashes the
 * handle on globalThis so the teardown can reach it. When flows are added,
 * this will also run `deployAll()` and persist addresses to each app's
 * `.e2e/` dir.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (process.env.GJ_E2E_SKIP_NETWORK === "1") {
    console.log("[e2e] GJ_E2E_SKIP_NETWORK=1 — skipping local-network startup");
    return;
  }
  const network = await startLocalNetwork();
  (globalThis as unknown as { __gjNetwork: LocalNetwork }).__gjNetwork = network;
  console.log(`[e2e] local-network ready (node=${network.nodeUrl} l1=${network.l1RpcUrl})`);
}
