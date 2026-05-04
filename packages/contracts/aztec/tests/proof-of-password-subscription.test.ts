import { describe, it, expect, beforeAll } from "vitest";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { Gas } from "@aztec/stdlib/gas";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { TokenContract, TokenContractArtifact } from "../noir/artifacts/Token.js";
import {
  ProofOfPasswordContract,
  ProofOfPasswordContractArtifact,
} from "../noir/artifacts/ProofOfPassword.js";

import { SubscriptionFPC, fpcSubscribeOverhead } from "../lib/subscription-fpc.js";
import { setupTestContext, type FPCTestContext } from "./utils.js";

const CONFIG_INDEX = 100000 + Math.floor(Math.random() * 100000);
const MAX_USES = 4;
const MAX_USERS = 10;
const SALT = Fr.random();
const SIGNING_PRIVATE_KEY = randomBytes(32);
const PASSWORD = "grego";

let ctx: FPCTestContext;

beforeAll(async () => {
  ctx = await setupTestContext();
});

describe("ProofOfPassword subscription", () => {
  let userWallet: EmbeddedWallet;
  let token: TokenContract;
  let pop: ProofOfPasswordContract;
  let recipientAddress: AztecAddress;
  let calibrated: { daGas: number; l2Gas: number; hasPublicCall: boolean };

  beforeAll(async () => {
    const {
      receipt: { contract: rawToken, instance: tokenInstance },
    } = await TokenContract.deploy(ctx.wallet, ctx.admin, "GregoCoin", "GC", 18).send({
      from: ctx.admin,
      wait: { returnReceipt: true },
    });
    token = rawToken;

    const {
      receipt: { contract: rawPop, instance: popInstance },
    } = await ProofOfPasswordContract.deploy(ctx.wallet, token.address, PASSWORD).send({
      from: ctx.admin,
      wait: { returnReceipt: true },
    });
    pop = rawPop;

    await token.methods.set_minter(pop.address, true).send({ from: ctx.admin });

    userWallet = await EmbeddedWallet.create(ctx.node, { ephemeral: true });
    await userWallet.registerContract(ctx.fpcInstance, SubscriptionFPC.artifact, ctx.fpcSecretKey);
    await userWallet.registerContract(tokenInstance, TokenContractArtifact);
    await userWallet.registerContract(popInstance, ProofOfPasswordContractArtifact);

    const recipientSecret = await Fr.random();
    const recipientAccountManager = await ctx.wallet.createECDSARAccount(
      recipientSecret,
      SALT,
      SIGNING_PRIVATE_KEY,
    );
    recipientAddress = recipientAccountManager.address;
    await recipientAccountManager.getDeployMethod().then((m) => m.send({ from: ctx.admin }));

    await userWallet.createECDSARAccount(recipientSecret, SALT, SIGNING_PRIVATE_KEY);
    await userWallet.registerSender(ctx.admin, "admin");

    const sampleCall = await pop.methods
      .check_password_and_mint(PASSWORD, recipientAddress)
      .getFunctionCall();

    calibrated = await ctx.fpc.helpers.calibrate({
      adminWallet: ctx.wallet,
      adminAddress: ctx.admin,
      sampleCall,
    });

    const subscribeTotal = new Gas(calibrated.daGas, calibrated.l2Gas).add(
      fpcSubscribeOverhead(calibrated.hasPublicCall),
    );
    const maxFee = subscribeTotal
      .computeFee((await ctx.node.getCurrentMinFees()).mul(50))
      .toBigInt();

    await ctx.fpc.methods
      .sign_up(sampleCall.to, sampleCall.selector, CONFIG_INDEX, MAX_USES, maxFee, MAX_USERS)
      .send({ from: ctx.admin });
  });

  it("subscribes via check_password_and_mint and recipient receives minted tokens", async () => {
    const fpc = ctx.fpc.withWallet(userWallet);
    const userPop = ProofOfPasswordContract.at(pop.address, userWallet);
    const sponsoredCall = await userPop.methods
      .check_password_and_mint(PASSWORD, recipientAddress)
      .getFunctionCall();

    await fpc.helpers.subscribe({
      call: sponsoredCall,
      configIndex: CONFIG_INDEX,
      userAddress: recipientAddress,
      gasLimits: { daGas: calibrated.daGas, l2Gas: calibrated.l2Gas },
      hasPublicCall: calibrated.hasPublicCall,
    });

    const userToken = TokenContract.at(token.address, userWallet);
    const { result: recipientBalance } = await userToken.methods
      .balance_of_private(recipientAddress)
      .simulate({ from: recipientAddress });

    expect(recipientBalance).toBe(1000n);
  });
});
