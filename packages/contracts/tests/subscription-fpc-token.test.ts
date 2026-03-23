import { describe, it, expect, beforeAll } from "vitest";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import type { FunctionCall } from "@aztec/aztec.js/abi";
import {
  TokenContract,
  TokenContractArtifact,
} from "@aztec/noir-contracts.js/Token";

import { SubscriptionFPC } from "../src/subscription-fpc.js";
import { setupTestContext, fundWithFeeJuice } from "./utils.js";

const PRODUCTION_INDEX = 1;
const MAX_USES = 3;
const MAX_USERS = 10;

const SALT = new Fr(0);
const USER_SECRET = await Fr.random();
const RECIPIENT_SECRET = await Fr.random();
const SIGNING_PRIVATE_KEY = randomBytes(32);
const SIGNING_PUBLIC_KEY = await new Ecdsa("secp256r1").computePublicKey(
  SIGNING_PRIVATE_KEY,
);

describe("SubscriptionFPC with TokenContract (multi-use)", () => {
  let node: AztecNode;
  let wallet: EmbeddedWallet;
  let userWallet: EmbeddedWallet;
  let admin: AztecAddress;
  let subscriptionFPC: SubscriptionFPC;
  let token: TokenContract;
  let userAddress: AztecAddress;
  let recipientAddress: AztecAddress;

  /**
   * Creates an authwit for a transfer_in_private call, authorizing the FPC
   * (as msg_sender/caller) to transfer on behalf of the user.
   */
  async function createTransferAuthWit(call: FunctionCall) {
    return userWallet.createAuthWit(userAddress, {
      caller: subscriptionFPC.address,
      call,
    });
  }

  beforeAll(async () => {
    const ctx = await setupTestContext();
    node = ctx.node;
    wallet = ctx.wallet;
    admin = ctx.admin;

    // Deploy SubscriptionFPC
    const {
      receipt: { contract: rawFpc, instance: fpcInstance },
    } = await SubscriptionFPC.deploy(wallet, admin).send({
      from: admin,
      wait: { returnReceipt: true },
    });
    subscriptionFPC = new SubscriptionFPC(rawFpc);

    // Fund the FPC
    await fundWithFeeJuice(ctx, subscriptionFPC.address);

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
    await userWallet.registerContract(fpcInstance, SubscriptionFPC.artifact);
    await userWallet.registerContract(tokenInstance, TokenContractArtifact);

    // Deploy the user account via admin (so it exists on-chain)
    const userAccountManager = await wallet.createECDSARAccount(
      USER_SECRET,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    userAddress = userAccountManager.address;
    const userDeployMethod = await userAccountManager.getDeployMethod();
    await userDeployMethod.send({ from: admin });

    // Create the account in the user's wallet
    await userWallet.createECDSARAccount(
      USER_SECRET,
      SALT,
      SIGNING_PRIVATE_KEY,
    );

    // Deploy the recipient account via admin (so it exists on-chain)
    const recipientAccountManager = await wallet.createECDSARAccount(
      RECIPIENT_SECRET,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    recipientAddress = recipientAccountManager.address;
    const recipientDeployMethod =
      await recipientAccountManager.getDeployMethod();
    await recipientDeployMethod.send({ from: admin });

    // Create the account in the user's wallet
    await userWallet.createECDSARAccount(
      RECIPIENT_SECRET,
      SALT,
      SIGNING_PRIVATE_KEY,
    );

    // Mint tokens to the user privately
    await token.methods
      .mint_to_private(userAddress, 1000n)
      .send({ from: admin });

    // Add admin as sender for the user to receive their notes
    await userWallet.registerSender(admin, "admin");
  });

  it("calibrates and sets up transfer_in_private as a sponsored app", async () => {
    const userToken = TokenContract.at(token.address, userWallet);

    // Build a sample transfer_in_private call for calibration
    const sampleCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 10n, 0)
      .getFunctionCall();

    // Create authwit so the FPC can call transfer_in_private on behalf of the user
    const authWit = await createTransferAuthWit(sampleCall);

    const { maxFee } = await subscriptionFPC.helpers.calibrate({
      adminWallet: wallet,
      adminAddress: admin,
      userWallet,
      userAddress,
      node,
      sampleCall,
      feeMultiplier: 10,
      authWitnesses: [authWit],
    });

    expect(maxFee).toBeGreaterThan(0n);

    // Sign up with multi-use config
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

    const authWit = await createTransferAuthWit(sponsoredCall);

    await fpc.helpers.subscribe({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress,
      authWitnesses: [authWit],
    });
  });

  it("uses the subscription for a second sponsored transfer (sponsor call)", async () => {
    const userToken = TokenContract.at(token.address, userWallet);
    const fpc = subscriptionFPC.withWallet(userWallet);

    const sponsoredCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 15n, 0)
      .getFunctionCall();

    const authWit = await createTransferAuthWit(sponsoredCall);

    await fpc.helpers.sponsor({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress,
      authWitnesses: [authWit],
    });
  });

  it("uses the subscription for a third sponsored transfer (last use)", async () => {
    const userToken = TokenContract.at(token.address, userWallet);
    const fpc = subscriptionFPC.withWallet(userWallet);

    const sponsoredCall = await userToken.methods
      .transfer_in_private(userAddress, recipientAddress, 5n, 0)
      .getFunctionCall();

    const authWit = await createTransferAuthWit(sponsoredCall);

    await fpc.helpers.sponsor({
      call: sponsoredCall,
      configIndex: PRODUCTION_INDEX,
      userAddress,
      authWitnesses: [authWit],
    });
  });

  it("verifies recipient received all transfers", async () => {
    const userToken = TokenContract.at(token.address, userWallet);

    // Recipient should have 10 + 15 + 5 = 30 tokens
    const { result: recipientBalance } = await userToken.methods
      .balance_of_private(recipientAddress)
      .simulate({ from: recipientAddress });

    expect(recipientBalance).toBe(30n);

    // User should have 1000 - 30 = 970 tokens
    const { result: userBalance } = await userToken.methods
      .balance_of_private(userAddress)
      .simulate({ from: userAddress });

    expect(userBalance).toBe(970n);
  });
});
