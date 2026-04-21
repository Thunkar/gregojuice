/**
 * High-level orchestration: bridge fee juice, wait for the L1→L2 message to
 * land, and submit the L2 claim tx. Scripts should reach for this over the
 * lower-level `bridgeFeeJuice` + `waitForL1ToL2Message` pair.
 */
import type { AztecNode } from "@aztec/aztec.js/node";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { Hex } from "viem";

import { bridgeFeeJuice, waitForL1ToL2Message } from "./bridge.ts";

/** Picked up by callers to decide warp-vs-poll without pulling in NetworkName. */
export type BridgeTimingMode = "warp" | "poll";

export interface BridgeAndClaimParams {
  node: AztecNode;
  /** L2 wallet used to send the claim transaction. Typically the recipient's own wallet. */
  wallet: EmbeddedWallet;
  /** The L2 address that will hold the FJ after the claim. */
  recipient: AztecAddress;
  /** Sender of the claim tx on L2 (usually the same as `recipient`). */
  claimFrom: AztecAddress;
  /**
   * Optional `fee` options object forwarded to the L2 claim tx. Typed as `unknown`
   * to avoid pulling the full @aztec/aztec.js fee types into this package; the
   * caller knows what it's passing (e.g. `{ paymentMethod: sponsoredFeePaymentMethod }`).
   */
  claimFeeOpts?: unknown;
  /** L1 RPC URL for the bridge tx. */
  l1RpcUrl: string;
  l1ChainId: number;
  /** Bridge amount (wei). Ignored when `mint=true`. */
  amount?: bigint;
  mint: boolean;
  /** L1 signer. When omitted and `mint=true` an ephemeral key is generated. */
  l1PrivateKey?: Hex;
  /** Local networks need active time-warp; everyone else polls. */
  mode: BridgeTimingMode;
  /** Cheat-code overrides for warp mode. */
  warpOpts?: { nodeUrl?: string; l1RpcUrl?: string };
  timeoutMs?: number;
}

export interface BridgeAndClaimResult {
  /** The bridge amount actually used (useful when the faucet dictates it). */
  amount: bigint;
  /** L1 address that funded the bridge tx. */
  l1Address: string;
}

/**
 * Full flow: L1 bridge → wait for L1→L2 inclusion → L2 claim tx.
 *
 * Requires `claimFrom` to be a **deployed** L2 account. For funding a fresh
 * admin account that hasn't been deployed yet, use `bridge`
 * instead and pass the claim into `FeeJuicePaymentMethodWithClaim` so the
 * claim + account-deploy land in a single tx.
 */
export async function bridgeAndClaim(
  params: BridgeAndClaimParams,
): Promise<BridgeAndClaimResult> {
  const { claim, l1Address } = await bridge(params);

  const feeJuice = FeeJuiceContract.at(params.wallet);
  await feeJuice.methods
    .claim(params.recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({
      from: params.claimFrom,
      ...(params.claimFeeOpts ? { fee: params.claimFeeOpts } : {}),
    } as Parameters<ReturnType<typeof feeJuice.methods.claim>["send"]>[0]);

  return { amount: BigInt(claim.claimAmount), l1Address };
}

export interface BridgeParams {
  node: AztecNode;
  recipient: AztecAddress;
  l1RpcUrl: string;
  l1ChainId: number;
  amount?: bigint;
  mint: boolean;
  l1PrivateKey?: Hex;
  mode: BridgeTimingMode;
  warpOpts?: { nodeUrl?: string; l1RpcUrl?: string };
  timeoutMs?: number;
}

export interface BridgeResult {
  /**
   * Exact shape `FeeJuicePaymentMethodWithClaim` expects (claimAmount,
   * claimSecret, messageLeafIndex + messageHash for bookkeeping).
   */
  claim: Awaited<ReturnType<typeof bridgeFeeJuice>>["claim"];
  l1Address: string;
}

/**
 * Bridges fee juice from L1 and waits until the L1→L2 message is available
 * on the node. Does **not** send the L2 claim tx — the caller is expected
 * to feed the returned claim into `FeeJuicePaymentMethodWithClaim` so the
 * claim happens inside whatever tx the recipient is already sending (e.g. a
 * schnorr-account deploy).
 */
export async function bridge(
  params: BridgeParams,
): Promise<BridgeResult> {
  const { claim, l1Address } = await bridgeFeeJuice({
    node: params.node,
    l1RpcUrl: params.l1RpcUrl,
    l1ChainId: params.l1ChainId,
    recipient: params.recipient,
    amount: params.amount,
    mint: params.mint,
    l1PrivateKey: params.l1PrivateKey,
  });

  const messageHash = Fr.fromHexString(claim.messageHash);
  await waitForL1ToL2Message({
    node: params.node,
    messageHash,
    mode: params.mode,
    timeoutMs: params.timeoutMs,
    warpOpts: params.warpOpts,
  });

  return { claim, l1Address };
}
