/**
 * Admin-mode helpers for local-network test orchestration.
 *
 * On `aztec start --local-network` the node exposes a debug RPC that lets us
 * advance L2 time on demand (`nodeDebug_mineBlock`) together with Anvil's
 * `evm_setNextBlockTimestamp`. The `CheatCodes` wrapper from
 * `@aztec/aztec/testing` bundles both into a single call.
 *
 * Script callers (deploy, deploy-subscription-fpc, mint) want a tiny surface:
 * given a fresh L1→L2 message, wait until the L2 node sees it as available.
 * This file provides exactly that.
 */
import type { AztecNode } from "@aztec/aztec.js/node";
import { createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";
import { CheatCodes } from "@aztec/aztec/testing";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { DateProvider } from "@aztec/foundation/timer";
import type { Fr } from "@aztec/foundation/curves/bn254";

const POLL_INTERVAL_MS = 1000;
const WARP_BY_SECONDS = 36n; // roughly one L2 slot

/**
 * Advances L1 + L2 time via the local-network admin RPCs until the given
 * L1→L2 message shows up as available on the node. Throws if the message
 * doesn't appear within `timeoutMs`.
 *
 * Local-network only — relies on `nodeDebug_mineBlock` and Anvil's
 * `evm_setNextBlockTimestamp`.
 */
export async function advanceL1ToL2Message(
  node: AztecNode,
  messageHash: Fr,
  opts: { nodeUrl?: string; l1RpcUrl?: string; timeoutMs?: number } = {},
): Promise<void> {
  const nodeUrl = opts.nodeUrl ?? process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
  const l1RpcUrl = opts.l1RpcUrl ?? process.env.ETHEREUM_HOST ?? "http://localhost:8545";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const nodeDebug = createAztecNodeDebugClient(nodeUrl);
  const cheatCodes = await CheatCodes.create([l1RpcUrl], node, new DateProvider());

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isL1ToL2MessageReady(node, messageHash)) return;
    await cheatCodes.warpL2TimeAtLeastBy(nodeDebug, WARP_BY_SECONDS);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`L1→L2 message ${messageHash.toString()} did not become available in time`);
}
