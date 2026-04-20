import { CheatCodes } from "@aztec/aztec/testing";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";
import { DateProvider } from "@aztec/foundation/timer";

/**
 * Starts a background loop that advances L1+L2 time + mines an L2 block
 * every `intervalMs`. Use this while the bridge app (or any other UI) is
 * waiting for an L1→L2 message to sync: local-network is idle unless we
 * push it.
 *
 * Usage:
 *   const stop = await pumpL2Blocks();
 *   try {
 *     await expect(...).toBeVisible(); // UI sees message ready
 *   } finally {
 *     await stop();
 *   }
 */
const WARP_BY_SECONDS = 36n; // one L2 slot

export async function pumpL2Blocks(
  opts: { nodeUrl?: string; l1RpcUrl?: string; intervalMs?: number } = {},
): Promise<() => Promise<void>> {
  const nodeUrl = opts.nodeUrl ?? "http://localhost:8080";
  const l1RpcUrl = opts.l1RpcUrl ?? "http://localhost:8545";
  const intervalMs = opts.intervalMs ?? 2000;

  const node = createAztecNodeClient(nodeUrl);
  const nodeDebug = createAztecNodeDebugClient(nodeUrl);
  const cheatCodes = await CheatCodes.create([l1RpcUrl], node, new DateProvider());

  let stopped = false;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  const loop = (async () => {
    while (!stopped) {
      try {
        await cheatCodes.warpL2TimeAtLeastBy(nodeDebug, WARP_BY_SECONDS);
      } catch (err) {
        // Swallow — the sequencer might refuse if we're mid-slot. Next iter
        // will retry.
        console.warn(`[pump-l2-blocks] warp failed: ${(err as Error).message}`);
      }
      if (stopped) break;
      await sleep(intervalMs);
    }
  })();

  return async () => {
    stopped = true;
    wake?.();
    await loop;
  };
}
