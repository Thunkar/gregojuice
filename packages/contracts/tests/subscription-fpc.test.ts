import { describe, it, expect, beforeAll } from "vitest";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import {
  getContractInstanceFromInstantiationParams,
  type ContractInstanceWithAddress,
} from "@aztec/aztec.js/contracts";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import type { AccountManager } from "@aztec/aztec.js/wallet";
import type { FunctionCall } from "@aztec/aztec.js/abi";
import {
  TokenContract,
  TokenContractArtifact,
} from "@aztec/noir-contracts.js/Token";

import { EcdsaAccountDeployerContract } from "../artifacts/EcdsaAccountDeployer.js";
import { SubscriptionFPC } from "../src/subscription-fpc.js";
import { setupTestContext, fundWithFeeJuice, GrieferWallet } from "./utils.js";

const PRODUCTION_INDEX = 1;
const SIGNING_PRIVATE_KEY = randomBytes(32);
const SIGNING_PUBLIC_KEY = await new Ecdsa("secp256r1").computePublicKey(
  SIGNING_PRIVATE_KEY,
);

// Shared state across both describe blocks
let node: AztecNode;
let wallet: EmbeddedWallet;
let admin: AztecAddress;
let subscriptionFPC: SubscriptionFPC;
let fpcInstance: ContractInstanceWithAddress;
let fpcSecretKey: Fr;

beforeAll(async () => {
  const ctx = await setupTestContext();
  node = ctx.node;
  wallet = ctx.wallet;
  admin = ctx.admin;

  // Deploy SubscriptionFPC with keys (so it can own private slot notes)
  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(
    wallet,
    admin,
  );
  fpcSecretKey = secretKey;
  const instance = await deployment.getInstance();
  await wallet.registerContract(instance, SubscriptionFPC.artifact, secretKey);
  const {
    receipt: { contract: rawFpc },
  } = await deployment.send({
    from: admin,
    wait: { returnReceipt: true },
  });
  subscriptionFPC = new SubscriptionFPC(rawFpc);
  fpcInstance = instance;

  // Fund the FPC with fee juice (slow L1 bridge — done once)
  await fundWithFeeJuice(ctx, subscriptionFPC.address);
});

// ─── Account Deployment Subscription ──────────────────────────────────────────

describe("Account deployment subscription", () => {
  let userWallet: EmbeddedWallet;
  let deployerAddress: AztecAddress;
  let subscribedAccountManager: AccountManager;

  beforeAll(async () => {
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
      fpcInstance,
      SubscriptionFPC.artifact,
      fpcSecretKey,
    );
    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
  });

  it("calibrates and sets up a sponsored app", async () => {
    const dummyAccount = await wallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      SIGNING_PRIVATE_KEY,
    );
    const sampleCall = await EcdsaAccountDeployerContract.at(
      deployerAddress,
      wallet,
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
      node,
      sampleCall,
      feeMultiplier: 50,
      additionalScopes: [dummyAccount.address],
    });

    expect(maxFee).toBeGreaterThan(0n);

    await subscriptionFPC.methods
      .sign_up(
        sampleCall.to,
        sampleCall.selector,
        PRODUCTION_INDEX,
        1 /* max_uses */,
        maxFee,
        1 /* max_users */,
      )
      .send({ from: admin });
  });

  it("allows a user to subscribe and get a sponsored call in the same tx", async () => {
    const fpc = subscriptionFPC.withWallet(userWallet);
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

// ─── Token Transfer Subscription (multi-use) ─────────────────────────────────

describe("Token transfer subscription (multi-use)", () => {
  const MAX_USES = 4; // subscribe consumes 1 use + 3 sponsor calls
  const MAX_USERS = 10;
  const SALT = new Fr(0);

  let userWallet: EmbeddedWallet;
  let token: TokenContract;
  let userAddress: AztecAddress;
  let recipientAddress: AztecAddress;

  beforeAll(async () => {
    // Deploy Token contract (admin is the minter)
    const {
      receipt: { contract: rawToken, instance: tokenInstance },
    } = await TokenContract.deploy(wallet, admin, "TestToken", "TT", 18).send({
      from: admin,
      wait: { returnReceipt: true },
    });
    token = rawToken;

    // Set up user wallet
    userWallet = await EmbeddedWallet.create(node, { ephemeral: true });

    // Register contracts in user wallet
    await userWallet.registerContract(
      fpcInstance,
      SubscriptionFPC.artifact,
      fpcSecretKey,
    );
    await userWallet.registerContract(tokenInstance, TokenContractArtifact);
    // Deploy the user account via admin (so it exists on-chain)
    const userSecret = await Fr.random();
    const userAccountManager = await wallet.createECDSARAccount(
      userSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    userAddress = userAccountManager.address;
    const userDeployMethod = await userAccountManager.getDeployMethod();
    await userDeployMethod.send({ from: admin });

    // Create the account in the user's wallet
    await userWallet.createECDSARAccount(userSecret, SALT, SIGNING_PRIVATE_KEY);

    // Deploy the recipient account via admin (so it exists on-chain)
    const recipientSecret = await Fr.random();
    const recipientAccountManager = await wallet.createECDSARAccount(
      recipientSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    recipientAddress = recipientAccountManager.address;
    const recipientDeployMethod =
      await recipientAccountManager.getDeployMethod();
    await recipientDeployMethod.send({ from: admin });

    // Create the account in the user's wallet
    await userWallet.createECDSARAccount(
      recipientSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );

    // Mint tokens to the admin privately
    await token.methods.mint_to_private(admin, 1000n).send({ from: admin });

    // Mint tokens to the user privately
    await token.methods
      .mint_to_private(userAddress, 1000n)
      .send({ from: admin });

    // Add admin as sender for the user to receive their minted token notes
    await userWallet.registerSender(admin, "admin");
  });

  it("calibrates and sets up transfer_in_private as a sponsored app", async () => {
    const sampleCall = await token.methods
      .transfer_in_private(admin, recipientAddress, 10n, 0)
      .getFunctionCall();

    const authwit = await wallet.createAuthWit(admin, {
      caller: subscriptionFPC.address,
      call: sampleCall,
    });

    const { maxFee } = await subscriptionFPC.helpers.calibrate({
      adminWallet: wallet,
      adminAddress: admin,
      node,
      sampleCall,
      feeMultiplier: 50,
      authWitnesses: [authwit],
    });

    expect(maxFee).toBeGreaterThan(0n);

    await subscriptionFPC.methods
      .sign_up(
        sampleCall.to,
        sampleCall.selector,
        PRODUCTION_INDEX,
        MAX_USES,
        maxFee,
        MAX_USERS,
      )
      .send({ from: admin });
  });

  it("subscribes and makes a sponsored transfer_in_private", async () => {
    const userToken = TokenContract.at(token.address, userWallet);
    const fpc = subscriptionFPC.withWallet(userWallet);

    const sponsoredCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 10n, 0)
      .getFunctionCall();

    const authWit = await userWallet.createAuthWit(userAddress, {
      caller: fpc.address,
      call: sponsoredCall,
    });

    await fpc.helpers.subscribe({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress,
      authWitnesses: [authWit],
    });
  });

  it("uses the subscription for a second sponsored transfer", async () => {
    const userToken = TokenContract.at(token.address, userWallet);
    const fpc = subscriptionFPC.withWallet(userWallet);

    const sponsoredCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 15n, 0)
      .getFunctionCall();

    const authWit = await userWallet.createAuthWit(userAddress, {
      caller: fpc.address,
      call: sponsoredCall,
    });
    await fpc.helpers.sponsor({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress,
      authWitnesses: [authWit],
    });
  });

  it("verifies recipient received all transfers", async () => {
    const userToken = TokenContract.at(token.address, userWallet);

    // subscribe(10) + sponsor(15) = 25
    const { result: recipientBalance } = await userToken.methods
      .balance_of_private(recipientAddress)
      .simulate({ from: recipientAddress });

    expect(recipientBalance).toBe(25n);

    const { result: userBalance } = await userToken.methods
      .balance_of_private(userAddress)
      .simulate({ from: userAddress });

    expect(userBalance).toBe(975n);
  });
});

// ─── Failure Cases ────────────────────────────────────────────────────────────

describe("Failure cases", () => {
  const FAILURE_INDEX = 2;
  const SALT = new Fr(0);

  let userWallet: EmbeddedWallet;
  let token: TokenContract;
  let userAddress: AztecAddress;
  let recipientAddress: AztecAddress;

  beforeAll(async () => {
    // Deploy Token contract
    const {
      receipt: { contract: rawToken, instance: tokenInstance },
    } = await TokenContract.deploy(wallet, admin, "FailToken", "FT", 18).send({
      from: admin,
      wait: { returnReceipt: true },
    });
    token = rawToken;

    // Set up user wallet
    userWallet = await EmbeddedWallet.create(node, { ephemeral: true });
    await userWallet.registerContract(
      fpcInstance,
      SubscriptionFPC.artifact,
      fpcSecretKey,
    );
    await userWallet.registerContract(tokenInstance, TokenContractArtifact);

    // Deploy user account
    const userSecret = await Fr.random();
    const userAccountManager = await wallet.createECDSARAccount(
      userSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    userAddress = userAccountManager.address;
    await (await userAccountManager.getDeployMethod()).send({ from: admin });
    await userWallet.createECDSARAccount(userSecret, SALT, SIGNING_PRIVATE_KEY);

    // Deploy recipient account
    const recipientSecret = await Fr.random();
    const recipientAccountManager = await wallet.createECDSARAccount(
      recipientSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    recipientAddress = recipientAccountManager.address;
    await (
      await recipientAccountManager.getDeployMethod()
    ).send({
      from: admin,
    });
    await userWallet.createECDSARAccount(
      recipientSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );

    // Mint tokens to user
    await token.methods
      .mint_to_private(userAddress, 1000n)
      .send({ from: admin });

    // Mint tokens to the admin privately
    await token.methods.mint_to_private(admin, 1000n).send({ from: admin });

    await userWallet.registerSender(admin, "admin");

    // Set up a sponsored app with max_uses=1, max_users=1
    const sampleCall = await token.methods
      .transfer_in_private(admin, recipientAddress, 1n, 0)
      .getFunctionCall();

    const authwit = await wallet.createAuthWit(admin, {
      caller: subscriptionFPC.address,
      call: sampleCall,
    });

    const { maxFee } = await subscriptionFPC.helpers.calibrate({
      adminWallet: wallet,
      adminAddress: admin,
      node,
      sampleCall,
      feeMultiplier: 50,
      authWitnesses: [authwit],
    });

    await subscriptionFPC.methods
      .sign_up(
        sampleCall.to,
        sampleCall.selector,
        FAILURE_INDEX,
        1 /* max_uses */,
        maxFee,
        1 /* max_users */,
      )
      .send({ from: admin });

    // Subscribe — consumes the only slot and the only use
    const userToken = TokenContract.at(token.address, userWallet);
    const subscribeCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 1n, 0)
      .getFunctionCall();
    const subscribeAuthWit = await userWallet.createAuthWit(userAddress, {
      caller: subscriptionFPC.address,
      call: subscribeCall,
    });

    const fpc = subscriptionFPC.withWallet(userWallet);
    await fpc.helpers.subscribe({
      call: subscribeCall,

      configIndex: FAILURE_INDEX,
      userAddress,
      authWitnesses: [subscribeAuthWit],
    });
  });

  it("rejects sponsor call when subscription uses are exhausted", async () => {
    const userToken = TokenContract.at(token.address, userWallet);
    const fpc = subscriptionFPC.withWallet(userWallet);

    const sponsoredCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 1n, 0)
      .getFunctionCall();

    const authWit = await userWallet.createAuthWit(userAddress, {
      caller: subscriptionFPC.address,
      call: sponsoredCall,
    });
    // The subscription had max_uses=1 and subscribe consumed it.
    // sponsor calls pop_notes which should fail — no note to pop.
    await expect(
      fpc.helpers.sponsor({
        call: sponsoredCall,
        configIndex: FAILURE_INDEX,
        userAddress,
        authWitnesses: [authWit],
      }),
    ).rejects.toThrow();
  });

  it("fails in simulation when no slots are available", async () => {
    // All slots are consumed in private. A griefer can't build a valid tx —
    // pop_notes finds no slot note and fails during simulation.

    const grieferWallet = await GrieferWallet.create(node, {
      ephemeral: true,
    });
    await grieferWallet.registerContract(
      fpcInstance,
      SubscriptionFPC.artifact,
      fpcSecretKey,
    );
    await grieferWallet.registerContract(
      await node.getContract(token.address),
      TokenContractArtifact,
    );

    // Create and deploy a griefer account
    const grieferSecret = await Fr.random();
    const grieferAccountManager = await wallet.createECDSARAccount(
      grieferSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    const grieferAddress = grieferAccountManager.address;
    await (await grieferAccountManager.getDeployMethod()).send({ from: admin });
    await grieferWallet.createECDSARAccount(
      grieferSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );

    const grieferToken = TokenContract.at(token.address, grieferWallet);
    const griefCall = await grieferToken.methods
      .transfer_in_private(grieferAddress, recipientAddress, 1n, 0)
      .getFunctionCall();

    const griefAuthWit = await grieferWallet.createAuthWit(grieferAddress, {
      caller: subscriptionFPC.address,
      call: griefCall,
    });

    const fpc = subscriptionFPC.withWallet(grieferWallet);

    // The subscribe call fails during simulation — no slot note to pop
    await expect(
      fpc.helpers.subscribe({
        call: griefCall,

        configIndex: FAILURE_INDEX,
        userAddress: grieferAddress,
        authWitnesses: [griefAuthWit],
      }),
    ).rejects.toThrow();
  });
});
