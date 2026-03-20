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
import { SubscriptionFPCContract } from "../artifacts/SubscriptionFPC.js";
import { EcdsaAccountDeployerContract } from "../artifacts/EcdsaAccountDeployer.js";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { randomBytes } from "@aztec/foundation/crypto/random";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import { FunctionSelector, FunctionType } from "@aztec/aztec.js/abi";
import { NO_FROM } from "@aztec/aztec.js/account";
import type { AccountManager } from "@aztec/aztec.js/wallet";
import { computeVarArgsHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URL = process.env.ETHEREUM_HOST ?? "http://localhost:8545";
const L1_CHAIN_ID = Number(process.env.L1_CHAIN_ID ?? 31337);
const MNEMONIC = "test test test test test test test test test test test junk";

describe("SubscriptionFPC", () => {
  let node: AztecNode;
  let wallet: EmbeddedWallet;
  let userWallet: EmbeddedWallet;
  let admin: AztecAddress;
  let subscriptionFPC: SubscriptionFPCContract;
  let feeJuice: FeeJuiceContract;
  let sponsoredApp: EcdsaAccountDeployerContract;
  let subscribedAccountManager: AccountManager;
  let signingPrivateKey: Buffer;
  let signingPublicKey: Buffer;

  beforeAll(async () => {
    // Connect to sandbox
    node = createAztecNodeClient(NODE_URL);
    await waitForNode(node);
    wallet = await EmbeddedWallet.create(node, { ephemeral: true });
    userWallet = await EmbeddedWallet.create(node, { ephemeral: true });

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
    ({ contract: subscriptionFPC } = await SubscriptionFPCContract.deploy(
      wallet,
      admin,
    ).send({
      from: admin,
    }));

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

    const deployerInstance = await getContractInstanceFromInstantiationParams(
      EcdsaAccountDeployerContract.artifact,
      { salt: new Fr(0) },
    );

    await wallet.registerContract(
      deployerInstance,
      EcdsaAccountDeployerContract.artifact,
    );
    await userWallet.registerContract(
      deployerInstance,
      EcdsaAccountDeployerContract.artifact,
    );

    sponsoredApp = EcdsaAccountDeployerContract.at(
      deployerInstance.address,
      wallet,
    );
    signingPrivateKey = randomBytes(32);
    signingPublicKey = await new Ecdsa("secp256r1").computePublicKey(
      signingPrivateKey,
    );
  });

  it("allows the admin to set a sponsored app", async () => {
    const currentFees = await node.getCurrentMinFees();

    const accountToDeploy = await wallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      signingPrivateKey,
    );

    const { estimatedGas } = await sponsoredApp.methods
      .deploy(
        accountToDeploy.address,
        await Fr.random(),
        Array.from(signingPublicKey.subarray(0, 32)),
        Array.from(signingPublicKey.subarray(32, 64)),
      )
      .simulate({
        from: admin,
        fee: { estimateGas: true },
        additionalScopes: [accountToDeploy.address],
      });

    const reasonableMaxFee = estimatedGas.gasLimits
      .computeFee(currentFees.mul(2))
      .toBigInt();

    await subscriptionFPC.methods
      .sign_up(
        sponsoredApp.address,
        await sponsoredApp.methods.deploy.selector(),
        0,
        1,
        reasonableMaxFee,
        1,
      )
      .send({ from: admin });
  });

  it("allows a user to subscribe to a sponsored app", async () => {
    const fpc = await subscriptionFPC.withWallet(userWallet);

    subscribedAccountManager = await userWallet.createECDSARAccount(
      await Fr.random(),
      await Fr.random(),
      signingPrivateKey,
    );

    const subscriptionFPCInstance = await node.getContract(fpc.address);

    await userWallet.registerContract(
      subscriptionFPCInstance,
      SubscriptionFPCContract.artifact,
    );

    await fpc.methods
      .subscribe(
        sponsoredApp.address,
        await sponsoredApp.methods.deploy.selector(),
        0,
        subscribedAccountManager.address,
      )
      .send({ from: NO_FROM });
  });

  it("allows the usage of the subscription to pay fees", async () => {
    const fpc = subscriptionFPC.withWallet(userWallet);
    const deployer = sponsoredApp.withWallet(userWallet);

    const sponsoredCall = await deployer.methods
      .deploy(
        subscribedAccountManager.address,
        await Fr.random(),
        Array.from(signingPublicKey.subarray(0, 32)),
        Array.from(signingPublicKey.subarray(32, 64)),
      )
      .getFunctionCall();

    const noirSponsoredCall = {
      args_hash: await computeVarArgsHash(sponsoredCall.args),
      function_selector: sponsoredCall.selector.toField(),
      hide_msg_sender: sponsoredCall.hideMsgSender,
      is_static: sponsoredCall.isStatic,
      target_address: sponsoredCall.to,
      is_public: sponsoredCall.type === FunctionType.PUBLIC,
    };

    const sponsoredInteraction = fpc.methods
      .sponsor(noirSponsoredCall, 0, subscribedAccountManager.address)
      .with({
        extraHashedArgs: [
          new HashedValues(
            sponsoredCall.args,
            await computeVarArgsHash(sponsoredCall.args),
          ),
        ],
      });

    const authwit = await userWallet.createAuthWit(
      subscribedAccountManager.address,
      {
        caller: fpc.address,
        call: sponsoredCall,
      },
    );

    const gas = await sponsoredInteraction.simulate({
      from: NO_FROM,
      fee: { estimateGas: true },
      additionalScopes: [subscribedAccountManager.address],
      authWitnesses: [authwit],
    });
  });
});
