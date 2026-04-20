import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet, type EmbeddedWalletOptions } from "@aztec/wallets/embedded";
import type { InteractionWaitOptions, SendReturn } from "@aztec/aztec.js/contracts";
import type { SendOptions } from "@aztec/aztec.js/wallet";
import type { ExecutionPayload } from "@aztec/stdlib/tx";
import { BaseWallet } from "@aztec/wallet-sdk/base-wallet";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { waitForL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { createLogger } from "@aztec/aztec.js/log";
import { Fr } from "@aztec/aztec.js/fields";
import { createEthereumChain } from "@aztec/ethereum/chain";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { expect } from "vitest";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URL = process.env.ETHEREUM_HOST ?? "http://localhost:8545";
const L1_CHAIN_ID = Number(process.env.L1_CHAIN_ID ?? 31337);
const MNEMONIC = "test test test test test test test test test test test junk";

export interface TestContext {
  node: AztecNode;
  wallet: EmbeddedWallet;
  admin: AztecAddress;
  feeJuice: FeeJuiceContract;
}

async function setupBaseContext(): Promise<TestContext> {
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

  const testAccounts = await getInitialTestAccountsData();
  const [admin] = await Promise.all(
    testAccounts.slice(0, 1).map(async (account) => {
      return (await wallet.createSchnorrAccount(account.secret, account.salt, account.signingKey))
        .address;
    }),
  );

  const feeJuice = FeeJuiceContract.at(wallet);

  return { node, wallet, admin, feeJuice };
}

/**
 * Bridges fee juice from L1 to a target L2 address.
 * Handles: L1 mint + bridge → advance blocks → wait for L1→L2 message → claim on L2.
 */
export async function fundWithFeeJuice(ctx: TestContext, target: AztecAddress): Promise<void> {
  const chain = createEthereumChain([L1_RPC_URL], L1_CHAIN_ID);
  const l1Client = createExtendedL1Client(chain.rpcUrls, MNEMONIC, chain.chainInfo);

  const portal = await L1FeeJuicePortalManager.new(ctx.node, l1Client, createLogger("test:bridge"));

  const claim = await portal.bridgeTokensPublic(target, undefined, true);

  // Advance L2 blocks so the L1→L2 message becomes available
  const advanceBlock = () => ctx.feeJuice.methods.check_balance(0).send({ from: ctx.admin });
  await advanceBlock();
  await advanceBlock();

  await waitForL1ToL2MessageReady(ctx.node, Fr.fromHexString(claim.messageHash), {
    timeoutSeconds: 120,
  });

  await ctx.feeJuice.methods
    .claim(target, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: ctx.admin });

  const { result: balance } = await ctx.feeJuice.methods
    .balance_of_public(target)
    .simulate({ from: ctx.admin });

  expect(balance).toBeGreaterThan(0n);
}

/**
 * EmbeddedWallet subclass that skips pre-simulation before sending.
 * EmbeddedWallet.sendTx simulates first to estimate gas, which causes
 * expected-to-revert txs to fail before they ever reach the node.
 * This wallet calls BaseWallet.sendTx directly, bypassing that simulation.
 */
export class GrieferWallet extends EmbeddedWallet {
  static override create<T extends EmbeddedWallet = GrieferWallet>(
    nodeOrUrl: string | AztecNode,
    options?: EmbeddedWalletOptions,
  ): Promise<T> {
    return super.create<T>(nodeOrUrl, options);
  }

  public override sendTx<W extends InteractionWaitOptions = undefined>(
    executionPayload: ExecutionPayload,
    opts: SendOptions<W>,
  ): Promise<SendReturn<W>> {
    return BaseWallet.prototype.sendTx.call(this, executionPayload, opts);
  }
}

// ── FPC test context ─────────────────────────────────────────────────

import type { ContractInstanceWithAddress } from "@aztec/aztec.js/contracts";
import { SubscriptionFPC } from "../lib/subscription-fpc.js";

export interface FPCTestContext extends TestContext {
  fpc: SubscriptionFPC;
  fpcInstance: ContractInstanceWithAddress;
  fpcSecretKey: Fr;
}

/**
 * Sets up the full test environment: node + admin wallet + deployed & funded SubscriptionFPC.
 */
export async function setupTestContext(): Promise<FPCTestContext> {
  const ctx = await setupBaseContext();

  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(ctx.wallet, ctx.admin);
  const fpcSecretKey = secretKey;
  const instance = await deployment.getInstance();
  await ctx.wallet.registerContract(instance, SubscriptionFPC.artifact, secretKey);
  const {
    receipt: { contract: rawFpc },
  } = await deployment.send({
    from: ctx.admin,
    wait: { returnReceipt: true },
  });
  const fpc = new SubscriptionFPC(rawFpc);

  await fundWithFeeJuice(ctx, fpc.address);

  return { ...ctx, fpc, fpcInstance: instance, fpcSecretKey };
}

// ── Gas measurement helpers ──────────────────────────────────────────

export interface GasValues {
  gasLimits: { daGas: number; l2Gas: number };
  teardownGasLimits: { daGas: number; l2Gas: number };
}

export function toGas(estimatedGas: any): GasValues {
  return {
    gasLimits: {
      daGas: Number(estimatedGas.gasLimits.daGas),
      l2Gas: Number(estimatedGas.gasLimits.l2Gas),
    },
    teardownGasLimits: {
      daGas: Number(estimatedGas.teardownGasLimits.daGas),
      l2Gas: Number(estimatedGas.teardownGasLimits.l2Gas),
    },
  };
}

export function logGas(label: string, gas: GasValues) {
  console.log(
    `  ${label}: DA=${gas.gasLimits.daGas}  L2=${gas.gasLimits.l2Gas}  teardown(DA=${gas.teardownGasLimits.daGas} L2=${gas.teardownGasLimits.l2Gas})`,
  );
}
