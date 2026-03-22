import { describe, it, expect, beforeAll } from "vitest";
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

import { EcdsaAccountDeployerContract } from "../artifacts/EcdsaAccountDeployer.js";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import { NO_FROM } from "@aztec/aztec.js/account";
import type { AccountManager } from "@aztec/aztec.js/wallet";
import { SubscriptionFPC } from "../src/sdk/index.js";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URL = process.env.ETHEREUM_HOST ?? "http://localhost:8545";
const L1_CHAIN_ID = Number(process.env.L1_CHAIN_ID ?? 31337);
const MNEMONIC = "test test test test test test test test test test test junk";

const PRODUCTION_INDEX = 1;
const SIGNING_PRIVATE_KEY = randomBytes(32);
const SIGNING_PUBLIC_KEY = await new Ecdsa("secp256r1").computePublicKey(
  SIGNING_PRIVATE_KEY,
);

describe("SubscriptionFPC", () => {
  let node: AztecNode;
  let wallet: EmbeddedWallet;
  let userWallet: EmbeddedWallet;
  let admin: AztecAddress;
  let subscriptionFPC: SubscriptionFPC;
  let feeJuice: FeeJuiceContract;

  let deployerAddress: AztecAddress;
  let subscribedAccountManager: AccountManager;
  beforeAll(async () => {
    // Connect to sandbox
    node = createAztecNodeClient(NODE_URL);
    await waitForNode(node);
    wallet = await EmbeddedWallet.create(node, { ephemeral: true });

    // Create test accounts (pre-funded with fee juice in sandbox)
    const testAccounts = await getInitialTestAccountsData();
    [admin] = await Promise.all(
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

    // Deploy SubscriptionFPC
    const {
      receipt: { contract: rawFpc, instance: subscriptionFPCInstance },
    } = await SubscriptionFPC.deploy(wallet, admin).send({
      from: admin,
      wait: { returnReceipt: true },
    });
    subscriptionFPC = new SubscriptionFPC(rawFpc);

    // Get FeeJuice subscriptionFPC handle
    feeJuice = FeeJuiceContract.at(wallet);

    // Set up L1 client to bridge tokens
    const chain = createEthereumChain([L1_RPC_URL], L1_CHAIN_ID);
    const l1Client = createExtendedL1Client(
      chain.rpcUrls,
      MNEMONIC,
      chain.chainInfo,
    );

    // Create portal manager from node info
    const portal = await L1FeeJuicePortalManager.new(
      node,
      l1Client,
      createLogger("test:bridge"),
    );

    // Mint on L1 + bridge to FPC address on L2
    const claim = await portal.bridgeTokensPublic(
      subscriptionFPC.address,
      undefined, // use default mint amount
      true, // mint tokens first (sandbox/testnet)
    );

    // Send dummy txs to advance L2 blocks so the L1→L2 message becomes available.
    // The sandbox only produces blocks when there are pending transactions.
    const advanceBlock = () =>
      feeJuice.methods.check_balance(0).send({ from: admin });
    await advanceBlock();
    await advanceBlock();

    // Wait for L1→L2 message to be available on L2
    await waitForL1ToL2MessageReady(node, Fr.fromHexString(claim.messageHash), {
      timeoutSeconds: 120,
    });

    // Claim the bridged fee juice on L2 (admin claims on behalf of FPC)
    await feeJuice.methods
      .claim(
        subscriptionFPC.address,
        claim.claimAmount,
        claim.claimSecret,
        claim.messageLeafIndex,
      )
      .send({ from: admin });

    // Verify FPC now has a fee juice balance
    const { result: balance } = await feeJuice.methods
      .balance_of_public(subscriptionFPC.address)
      .simulate({ from: admin });

    expect(balance).toBeGreaterThan(0n);

    userWallet = await EmbeddedWallet.create(node, { ephemeral: true });

    const deployerInstance = await getContractInstanceFromInstantiationParams(
      EcdsaAccountDeployerContract.artifact,
      { salt: new Fr(0) },
    );

    deployerAddress = deployerInstance.address;

    await wallet.registerContract(
      deployerInstance,
      EcdsaAccountDeployerContract.artifact,
    );
    await userWallet.registerContract(
      deployerInstance,
      EcdsaAccountDeployerContract.artifact,
    );
    await userWallet.registerContract(
      subscriptionFPCInstance,
      SubscriptionFPC.artifact,
    );

    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
  });

  it("calibrates and sets up a sponsored app", async () => {
    const dummyAccount = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
    const sampleCall = await EcdsaAccountDeployerContract.at(
      deployerAddress,
      userWallet,
    )
      .methods.deploy(
        dummyAccount.address,
        await Fr.random(),
        Array.from(SIGNING_PUBLIC_KEY.subarray(0, 32)),
        Array.from(SIGNING_PUBLIC_KEY.subarray(32, 64)),
      )
      .getFunctionCall();
    const { maxFee } = await subscriptionFPC.helpers.setup({
      adminWallet: wallet,
      adminAddress: admin,
      userWallet: userWallet,
      userAddress: dummyAccount.address,
      node,
      sampleCall,
      feeMultiplier: 10,
    });

    expect(maxFee).toBeGreaterThan(0n);
  });

  it("allows a user to subscribe to a sponsored app", async () => {
    const fpc = await subscriptionFPC.withWallet(userWallet);

    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );

    const subscriptionFPCInstance = await node.getContract(fpc.address);

    await userWallet.registerContract(
      subscriptionFPCInstance,
      SubscriptionFPC.artifact,
    );

    const selector = await EcdsaAccountDeployerContract.at(
      deployerAddress,
      userWallet,
    ).methods.deploy.selector();

    await fpc.methods
      .subscribe(
        deployerAddress,
        selector,
        PRODUCTION_INDEX,
        subscribedAccountManager.address,
      )
      .send({ from: NO_FROM });
  });

  it("allows the usage of the subscription to pay fees", async () => {
    const fpc = subscriptionFPC.withWallet(userWallet);
    const deployer = EcdsaAccountDeployerContract.at(
      deployerAddress,
      userWallet,
    );

    const sponsoredCall = await deployer.methods
      .deploy(
        subscribedAccountManager.address,
        await Fr.random(),
        Array.from(SIGNING_PUBLIC_KEY.subarray(0, 32)),
        Array.from(SIGNING_PUBLIC_KEY.subarray(32, 64)),
      )
      .getFunctionCall();

    await fpc.helpers.sponsor({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress: subscribedAccountManager.address,
    });
  });
});
