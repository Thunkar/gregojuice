import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
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

/**
 * Connects to the sandbox, creates an admin wallet from the first test account,
 * and returns the shared test context.
 */
export async function setupTestContext(): Promise<TestContext> {
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

  const testAccounts = await getInitialTestAccountsData();
  const [admin] = await Promise.all(
    testAccounts.slice(0, 1).map(async (account) => {
      return (
        await wallet.createSchnorrAccount(
          account.secret,
          account.salt,
          account.signingKey,
        )
      ).address;
    }),
  );

  const feeJuice = FeeJuiceContract.at(wallet);

  return { node, wallet, admin, feeJuice };
}

/**
 * Bridges fee juice from L1 to a target L2 address.
 * Handles: L1 mint + bridge → advance blocks → wait for L1→L2 message → claim on L2.
 */
export async function fundWithFeeJuice(
  ctx: TestContext,
  target: AztecAddress,
): Promise<void> {
  const chain = createEthereumChain([L1_RPC_URL], L1_CHAIN_ID);
  const l1Client = createExtendedL1Client(
    chain.rpcUrls,
    MNEMONIC,
    chain.chainInfo,
  );

  const portal = await L1FeeJuicePortalManager.new(
    ctx.node,
    l1Client,
    createLogger("test:bridge"),
  );

  const claim = await portal.bridgeTokensPublic(target, undefined, true);

  // Advance L2 blocks so the L1→L2 message becomes available
  const advanceBlock = () =>
    ctx.feeJuice.methods.check_balance(0).send({ from: ctx.admin });
  await advanceBlock();
  await advanceBlock();

  await waitForL1ToL2MessageReady(
    ctx.node,
    Fr.fromHexString(claim.messageHash),
    { timeoutSeconds: 120 },
  );

  await ctx.feeJuice.methods
    .claim(target, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: ctx.admin });

  const { result: balance } = await ctx.feeJuice.methods
    .balance_of_public(target)
    .simulate({ from: ctx.admin });

  expect(balance).toBeGreaterThan(0n);
}
