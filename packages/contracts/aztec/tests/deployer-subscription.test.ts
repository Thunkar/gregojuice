import { describe, it, expect, beforeAll } from "vitest";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import type { AccountManager } from "@aztec/aztec.js/wallet";

import { EcdsaAccountDeployerContract } from "../noir/artifacts/EcdsaAccountDeployer.js";
import { SubscriptionFPC } from "../lib/subscription-fpc.js";
import { setupTestContext, type FPCTestContext } from "./utils.js";

const PRODUCTION_INDEX = 100000 + Math.floor(Math.random() * 100000);
const SIGNING_PRIVATE_KEY = randomBytes(32);
const SIGNING_PUBLIC_KEY = await new Ecdsa("secp256r1").computePublicKey(SIGNING_PRIVATE_KEY);

let ctx: FPCTestContext;

beforeAll(async () => {
  ctx = await setupTestContext();
});

describe("Account deployment subscription", () => {
  let userWallet: EmbeddedWallet;
  let deployerAddress: AztecAddress;
  let subscribedAccountManager: AccountManager;

  beforeAll(async () => {
    userWallet = await EmbeddedWallet.create(ctx.node, { ephemeral: true });

    const deployerInstance = await getContractInstanceFromInstantiationParams(
      EcdsaAccountDeployerContract.artifact,
      { salt: new Fr(0) },
    );
    deployerAddress = deployerInstance.address;

    await ctx.wallet.registerContract(deployerInstance, EcdsaAccountDeployerContract.artifact);
    await userWallet.registerContract(deployerInstance, EcdsaAccountDeployerContract.artifact);
    await userWallet.registerContract(ctx.fpcInstance, SubscriptionFPC.artifact, ctx.fpcSecretKey);
    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
  });

  it("calibrates and sets up a sponsored app", async () => {
    const dummyAccount = await ctx.wallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
    const sampleCall = await EcdsaAccountDeployerContract.at(deployerAddress, ctx.wallet)
      .methods.deploy(
        dummyAccount.address,
        await Fr.random(),
        Array.from(SIGNING_PUBLIC_KEY.subarray(0, 32)),
        Array.from(SIGNING_PUBLIC_KEY.subarray(32, 64)),
      )
      .getFunctionCall();

    const { maxFee } = await ctx.fpc.helpers.calibrate({
      adminWallet: ctx.wallet,
      adminAddress: ctx.admin,
      node: ctx.node,
      sampleCall,
      feeMultiplier: 50,
      additionalScopes: [dummyAccount.address],
    });

    expect(maxFee).toBeGreaterThan(0n);

    await ctx.fpc.methods
      .sign_up(sampleCall.to, sampleCall.selector, PRODUCTION_INDEX, 1, maxFee, 1)
      .send({ from: ctx.admin });
  });

  it("allows a user to subscribe and get a sponsored call in the same tx", async () => {
    const fpc = ctx.fpc.withWallet(userWallet);
    const deployer = EcdsaAccountDeployerContract.at(deployerAddress, userWallet);

    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );

    const subscriptionFPCInstance = await ctx.node.getContract(fpc.address);
    await userWallet.registerContract(subscriptionFPCInstance!, SubscriptionFPC.artifact);

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
