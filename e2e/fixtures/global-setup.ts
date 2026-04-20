import type { FullConfig } from "@playwright/test";
import { startLocalNetwork, type LocalNetwork } from "./local-network.ts";
import { deployL1BridgeContract } from "./deploy-l1-bridge.ts";
import { deriveSwapAdmin } from "./derive-swap-admin.ts";
import { resetStateDir, writeState, STATE_FILES, type GlobalState } from "./state.ts";

/**
 * Runs before any spec. Produces the baseline stack used by every spec:
 *   1. `aztec start --local-network`
 *   2. L1 bridge contract deployed (via CREATE2, idempotent — always at the
 *      same deterministic address)
 *   3. Deterministic swap-admin identity derived
 *   4. `e2e/.state/global.json` written
 *
 * Later product specs (fpc-dashboard, bridge, swap) run against this baseline
 * and produce their own state files.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await resetStateDir();

  if (process.env.E2E_SKIP_NETWORK === "1") {
    console.log("[e2e] E2E_SKIP_NETWORK=1 — skipping local-network startup");
  } else {
    const network = await startLocalNetwork();
    (globalThis as unknown as { __gjNetwork: LocalNetwork }).__gjNetwork = network;
    console.log(`[e2e] local-network ready (node=${network.nodeUrl} l1=${network.l1RpcUrl})`);
  }

  const nodeUrl = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
  const l1RpcUrl = process.env.ETHEREUM_HOST ?? "http://localhost:8545";

  console.log("[e2e] deploying L1 bridge contract (CREATE2)...");
  const l1BridgeAddress = await deployL1BridgeContract(l1RpcUrl);
  console.log(`[e2e] L1 bridge at ${l1BridgeAddress}`);

  console.log("[e2e] deriving swap-admin identity...");
  const swapAdmin = await deriveSwapAdmin(nodeUrl);
  console.log(`[e2e] swap-admin address: ${swapAdmin.address}`);

  const state: GlobalState = {
    nodeUrl,
    l1RpcUrl,
    chainId: 31337,
    l1BridgeAddress,
    swapAdmin,
  };
  await writeState(STATE_FILES.global, state);
  console.log(`[e2e] wrote ${STATE_FILES.global}`);
}
