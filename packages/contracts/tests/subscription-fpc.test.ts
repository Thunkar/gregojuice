import { describe, it, expect, beforeAll } from "vitest";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import type { AccountManager } from "@aztec/aztec.js/wallet";

import { EcdsaAccountDeployerContract } from "../artifacts/EcdsaAccountDeployer.js";
import { SubscriptionFPC } from "../src/subscription-fpc.js";
import { setupTestContext, fundWithFeeJuice } from "./utils.js";

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

  let deployerAddress: AztecAddress;
  let subscribedAccountManager: AccountManager;

  beforeAll(async () => {
    const ctx = await setupTestContext();
    node = ctx.node;
    wallet = ctx.wallet;
    admin = ctx.admin;

    // Deploy SubscriptionFPC
    const {
      receipt: { contract: rawFpc, instance: subscriptionFPCInstance },
    } = await SubscriptionFPC.deploy(wallet, admin).send({
      from: admin,
      wait: { returnReceipt: true },
    });
    subscriptionFPC = new SubscriptionFPC(rawFpc);

    // Fund the FPC with fee juice
    await fundWithFeeJuice(ctx, subscriptionFPC.address);

    // Set up user wallet
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

    const { maxFee } = await subscriptionFPC.helpers.calibrate({
      adminWallet: wallet,
      adminAddress: admin,
      userWallet: userWallet,
      userAddress: dummyAccount.address,
      node,
      sampleCall,
      feeMultiplier: 10,
    });

    expect(maxFee).toBeGreaterThan(0n);

    await subscriptionFPC.methods
      .sign_up(
        sampleCall.to,
        sampleCall.selector,
        PRODUCTION_INDEX /* current_index */,
        1 /* max_uses */,
        maxFee,
        1 /* max_users */,
      )
      .send({ from: admin });
  });

  it("allows a user to subscribe to an app and get a sponsored call in the same tx", async () => {
    const fpc = await subscriptionFPC.withWallet(userWallet);
    const deployer = EcdsaAccountDeployerContract.at(
      deployerAddress,
      userWallet,
    );

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

    const sponsoredCall = await deployer.methods
      .deploy(
        subscribedAccountManager.address,
        await Fr.random(),
        Array.from(SIGNING_PUBLIC_KEY.subarray(0, 32)),
        Array.from(SIGNING_PUBLIC_KEY.subarray(32, 64)),
      )
      .getFunctionCall();

    await fpc.helpers.subscribe({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress: subscribedAccountManager.address,
    });
  });
});
