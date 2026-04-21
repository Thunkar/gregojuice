/**
 * Node-side fee-juice bridging. Mirrors the UI bridge app's faucet/non-faucet
 * split, but uses a provided L1 private key (or generates a random one on the
 * faucet path) instead of a browser wallet.
 */
import type { AztecNode } from "@aztec/aztec.js/node";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { createEthereumChain } from "@aztec/ethereum/chain";
import { createLogger } from "@aztec/foundation/log";
import { Fr } from "@aztec/foundation/curves/bn254";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

import { advanceL1ToL2Message } from "./cheat-codes.ts";

export interface BridgeFeeJuiceParams {
  node: AztecNode;
  l1RpcUrl: string;
  l1ChainId: number;
  /** Aztec recipient. */
  recipient: AztecAddress;
  /**
   * Desired amount in wei to bridge. Used only on the non-faucet path; when
   * the faucet path kicks in, the handler's `mintAmount()` is authoritative.
   */
  amount?: bigint;
  /**
   * L1 private key to sign the bridge tx. When omitted, a fresh ephemeral
   * key is generated — only useful when the faucet handler is present.
   */
  l1PrivateKey?: Hex;
}

export interface BridgeFeeJuiceResult {
  /** Full claim credentials returned by `L1FeeJuicePortalManager.bridgeTokensPublic`. */
  claim: Awaited<ReturnType<L1FeeJuicePortalManager["bridgeTokensPublic"]>>;
  /** The L1 address that actually paid for the tx — useful for logging. */
  l1Address: string;
  /** Whether the faucet/mint path was used. */
  minted: boolean;
}

/**
 * Bridges fee juice to an L2 recipient. Mirrors the bridge UI's decision:
 *   - faucet handler exists AND L1 signer has no FJ → mint via the handler
 *   - otherwise → transfer the caller's existing FJ balance to the portal
 *
 * Throws only if neither path is viable (handler missing AND signer has no FJ,
 * or non-faucet path requested with no `amount` specified).
 */
export async function bridgeFeeJuice(params: BridgeFeeJuiceParams): Promise<BridgeFeeJuiceResult> {
  const { node, l1RpcUrl, l1ChainId, recipient } = params;

  const l1PrivateKey: Hex = params.l1PrivateKey ?? generatePrivateKey();
  const chain = createEthereumChain([l1RpcUrl], l1ChainId);
  const l1Client = createExtendedL1Client(chain.rpcUrls, l1PrivateKey, chain.chainInfo);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, createLogger("bridging"));

  const tokenManager = portalManager.getTokenManager();
  const hasFaucet = tokenManager.handlerAddress !== undefined;
  const signerAddress = l1Client.account.address;
  const l1Balance = await tokenManager.getL1TokenBalance(signerAddress);

  // Mirror the UI: faucetLocked = handler exists AND user has no balance.
  const minted = hasFaucet && l1Balance === 0n;
  if (!minted && !hasFaucet && l1Balance === 0n) {
    throw new Error(
      `L1 signer ${signerAddress} has no FJ balance and no fee-asset handler is available for minting.`,
    );
  }

  let amountArg: bigint | undefined;
  if (minted) {
    // Faucet path: handler's mintAmount() dictates the amount.
    amountArg = undefined;
  } else {
    if (params.amount === undefined) {
      throw new Error(
        `bridgeFeeJuice: \`amount\` is required when the faucet path is not used (L1 signer holds ${l1Balance} FJ).`,
      );
    }
    amountArg = params.amount;
  }

  const claim = await portalManager.bridgeTokensPublic(recipient, amountArg, minted);
  return { claim, l1Address: signerAddress, minted };
}

export interface WaitForClaimParams {
  node: AztecNode;
  messageHash: Fr;
  /**
   * On `local` we can't rely on the sequencer to mine blocks, so we advance L1
   * + L2 time via admin RPCs until the message shows as available.
   * On every other network we just poll.
   */
  mode: "warp" | "poll";
  /** How long to wait before giving up (default 30 minutes for poll, 2 minutes for warp). */
  timeoutMs?: number;
  /** Local-only overrides for the warp cheat codes. */
  warpOpts?: { nodeUrl?: string; l1RpcUrl?: string };
}

/**
 * Waits until an L1→L2 message is available on the node. In `warp` mode it
 * actively pushes time forward via the local-network debug RPCs. In `poll`
 * mode it just checks periodically.
 */
export async function waitForL1ToL2Message(params: WaitForClaimParams): Promise<void> {
  const { node, messageHash, mode } = params;

  if (mode === "warp") {
    await advanceL1ToL2Message(node, messageHash, {
      ...params.warpOpts,
      timeoutMs: params.timeoutMs ?? 120_000,
    });
    return;
  }

  // Poll mode — import lazily to keep the cheat-code dependency tree optional.
  const { isL1ToL2MessageReady } = await import("@aztec/aztec.js/messaging");
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 30 * 60_000;
  const deadline = startedAt + timeoutMs;
  console.error(
    `Waiting for L1→L2 message ${messageHash.toString()} (up to ${Math.round(timeoutMs / 60_000)} min)...`,
  );
  let lastLog = startedAt;
  while (Date.now() < deadline) {
    if (await isL1ToL2MessageReady(node, messageHash)) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.error(`  L1→L2 message ready after ${elapsed}s.`);
      return;
    }
    if (Date.now() - lastLog > 30_000) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.error(`  still waiting (${elapsed}s elapsed)...`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`L1→L2 message ${messageHash.toString()} did not become available in time`);
}
