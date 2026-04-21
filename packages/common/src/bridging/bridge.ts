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
   * Amount in wei to bridge. Required when `mint=false`; ignored when `mint=true`
   * (faucet handler dictates the amount via `mintAmount()`).
   */
  amount?: bigint;
  /**
   * When true, the portal manager mints tokens via the network's fee-asset
   * handler. Only valid on networks that expose one (faucet-mode testnets).
   */
  mint: boolean;
  /**
   * L1 private key to sign the bridge tx. When omitted *and* `mint=true`, a
   * fresh ephemeral key is generated — the faucet does not require the caller
   * to hold any balance.
   */
  l1PrivateKey?: Hex;
}

export interface BridgeFeeJuiceResult {
  /** Full claim credentials returned by `L1FeeJuicePortalManager.bridgeTokensPublic`. */
  claim: Awaited<ReturnType<L1FeeJuicePortalManager["bridgeTokensPublic"]>>;
  /** The L1 address that actually paid for the tx — useful for logging. */
  l1Address: string;
}

/**
 * Bridges fee juice to an L2 recipient. Returns the claim credentials so the
 * caller can finalise on L2 (see `waitForL1ToL2AndClaim`).
 */
export async function bridgeFeeJuice(params: BridgeFeeJuiceParams): Promise<BridgeFeeJuiceResult> {
  const { node, l1RpcUrl, l1ChainId, recipient, mint } = params;
  const amount = params.amount;

  if (!mint && amount === undefined) {
    throw new Error("bridgeFeeJuice: `amount` is required when `mint=false`");
  }

  const l1PrivateKey: Hex = params.l1PrivateKey ?? generatePrivateKey();
  const chain = createEthereumChain([l1RpcUrl], l1ChainId);
  const l1Client = createExtendedL1Client(chain.rpcUrls, l1PrivateKey, chain.chainInfo);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, createLogger("bridging"));

  // On faucet-mode bridges the handler's mintAmount() is authoritative. Pass
  // undefined so the manager fetches it for us.
  const amountArg = mint ? undefined : amount;
  const claim = await portalManager.bridgeTokensPublic(recipient, amountArg, mint);
  return { claim, l1Address: l1Client.account.address };
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
  const deadline = Date.now() + (params.timeoutMs ?? 30 * 60_000);
  while (Date.now() < deadline) {
    if (await isL1ToL2MessageReady(node, messageHash)) return;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`L1→L2 message ${messageHash.toString()} did not become available in time`);
}
