/**
 * Deploys the SubscriptionFPC contract to the local sandbox and updates local.json config.
 *
 * Usage: node --experimental-transform-types scripts/deploy-subscription-fpc.ts
 */
import fs from "fs";
import path from "path";
import { SubscriptionFPC } from "@gregojuice/aztec/subscription-fpc";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "@gregojuice/aztec/artifacts/SubscriptionFPC";
import { FunctionSelector } from "@aztec/stdlib/abi";
import type { ContractArtifact } from "@aztec/aztec.js/abi";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { waitForL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { createLogger } from "@aztec/foundation/log";
import { foundry } from "viem/chains";
import { Fr } from "@aztec/foundation/curves/bn254";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { ProofOfPasswordContractArtifact } from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { AMMContractArtifact } from "@gregojuice/aztec/artifacts/AMM";
import { TokenContractArtifact } from "@gregojuice/aztec/artifacts/Token";
import { setupWallet, getOrCreateDeployer } from "./utils.ts";
import type { AztecNode } from "@aztec/aztec.js/node";

interface FpcSignupSpec {
  artifact: ContractArtifact;
  functionName: string;
  contractAlias: string[];
  /** Max sponsored calls per subscribed user. Falls back to DEFAULTS.fpcSignupDefaults.maxUses. */
  maxUses?: number;
  /** Max fee (in FJ wei) the FPC will cover per sponsored call. Falls back to DEFAULTS.fpcSignupDefaults.maxFee. */
  maxFee?: bigint;
  /** Max concurrent subscribers for this slot. Falls back to DEFAULTS.fpcSignupDefaults.maxUsers. */
  maxUsers?: number;
}

const DEFAULTS = {
  // Path to the network config file to load/update.
  // Overridable via NETWORK_CONFIG_PATH env var.
  configPath: path.join(import.meta.dirname, "../src/config/networks/local.json"),

  // L1 RPC URL used for fee juice bridging.
  // Defaults to local Anvil. Persisted to the network config on first run.
  l1RpcUrl: "http://localhost:8545",

  // Private key used to sign L1 transactions during FPC setup (fee juice bridging, etc.).
  // Defaults to Anvil's pre-funded account #0 for local sandbox development.
  // Persisted to the network config on first run so it can be overridden per-network.
  l1FunderKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",

  // Default sign-up parameters applied to each FpcSignupSpec that doesn't override them.
  fpcSignupDefaults: {
    maxUses: 100,
    maxFee: BigInt("1000000000000000000000"), // 1000 FJ
    maxUsers: 100,
  },

  // Contract functions to sign up on the SubscriptionFPC.
  fpcSignups: [
    {
      artifact: ProofOfPasswordContractArtifact,
      functionName: "check_password_and_mint",
      contractAlias: ["pop"],
    },
    {
      artifact: AMMContractArtifact,
      functionName: "swap_tokens_for_exact_tokens_from",
      contractAlias: ["amm"],
    },
    {
      artifact: TokenContractArtifact,
      functionName: "transfer_in_private_deliver_offchain",
      contractAlias: ["gregoCoin", "gregoCoinPremium"],
    },
  ] as FpcSignupSpec[],
};

async function main() {
  const configPath = process.env.NETWORK_CONFIG_PATH ?? DEFAULTS.configPath;
  const config = loadConfig(configPath);

  const { wallet, node, paymentMethod } = await setupWallet(config.nodeUrl, "local");
  const fpcDeployer = await getOrCreateDeployer(wallet, paymentMethod);

  const { fpcAddress, secretKey } = await deployAndRegisterSubscriptionFpc(
    node,
    wallet,
    fpcDeployer,
    paymentMethod,
  );

  // Order matters here:
  //
  // 1. bridgeTokens() submits the L1 mint + bridge tx. This is only the L1 half of the flow: the L1->L2 message is now
  //    pending and needs the L2 sequencer to pick it up before we can claim. On local setups L2 sequencer is quiet
  //    when nothing else is happening, so we can't just wait.
  //
  // 2. executeFpcSignUps() fires a burst of L2 txs (one per sponsored function). Beyond their functional purpose,
  //    these txs force L2 block production, which advances the chain past the checkpoint containing our pending bridge
  //    message.
  //
  // 3. claimFeeJuiceOnL2() claims tx crediting the FPC's public fee juice balance so it can actually sponsor user
  //    calls.
  //
  // If we did them in the "obvious" order (bridge -> claim -> sign_up), the claim would hang forever waiting for an L2
  // block that never comes... so it is a bit of a hack, but it works.
  const feeJuiceClaim = await bridgeTokens(node, config.l1RpcUrl, config.l1FunderKey, fpcAddress);
  const signedUpFunctions = await executeFpcSignUps(
    fpcAddress,
    fpcDeployer,
    wallet,
    paymentMethod,
    config.contracts,
  );
  await claimFeeJuiceOnL2(node, feeJuiceClaim, wallet, fpcAddress, fpcDeployer, paymentMethod);
  updateNetworkConfigFile(config, fpcAddress, secretKey, signedUpFunctions, configPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function loadConfig(configPath: string) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config.l1RpcUrl = config.l1RpcUrl ?? DEFAULTS.l1RpcUrl;
  config.l1FunderKey = config.l1FunderKey ?? DEFAULTS.l1FunderKey;
  return config;
}

async function claimFeeJuiceOnL2(
  node: AztecNode,
  feeJuiceClaim,
  wallet: EmbeddedWallet,
  fpcAddress: AztecAddress,
  fpcDeployer: AztecAddress,
  paymentMethod: SponsoredFeePaymentMethod,
) {
  // Wait for the L1->L2 bridge message and claim the FJ to credit the FPC's balance.
  console.log("\nWaiting for L1->L2 message sync...");
  await waitForL1ToL2MessageReady(node, Fr.fromHexString(feeJuiceClaim.messageHash), {
    timeoutSeconds: 120,
  });
  console.log("Message ready");

  console.log("Claiming fee juice on L2 for FPC...");
  await FeeJuiceContract.at(wallet)
    .methods.claim(
      fpcAddress,
      feeJuiceClaim.claimAmount,
      feeJuiceClaim.claimSecret,
      feeJuiceClaim.messageLeafIndex,
    )
    .send({ from: fpcDeployer, fee: { paymentMethod } });
  console.log("FPC funded!");
}

// Auxiliaries

function updateNetworkConfigFile(
  config: any,
  fpcAddress: AztecAddress,
  secretKey: Fr,
  signedUpFunctions: ResolvedSignup[],
  configPath: string,
) {
  config.subscriptionFPC = {
    address: fpcAddress.toString(),
    secretKey: secretKey.toString(),
    functions: buildFunctionsMap(signedUpFunctions),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nUpdated ${configPath} with subscriptionFPC config.`);
}

async function bridgeTokens(
  node: AztecNode,
  l1RpcUrl: string,
  l1FunderKey: string,
  fpcAddress: AztecAddress,
) {
  const l1Client = createExtendedL1Client([l1RpcUrl], l1FunderKey, foundry);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, createLogger("bridge"));

  const bridgeAmount: bigint = BigInt("1000000000000000000000"); // 1000 FJ
  console.log(`\nBridging ${bridgeAmount} wei of fee juice to FPC...`);
  // When mint=true, bridgeTokensPublic must match the exact bridgeAmount.
  const claim = await portalManager.bridgeTokensPublic(fpcAddress, bridgeAmount, true);
  console.log("L1 bridge tx mined.");
  return claim;
}

/**
 * Executes sign_up transactions on the SubscriptionFPC for each resolved signup.
 * Must be called by the FPC admin with a working payment method.
 */
async function executeFpcSignUps(
  fpcAddress: AztecAddress,
  fpcDeployer: AztecAddress,
  wallet: EmbeddedWallet,
  paymentMethod: SponsoredFeePaymentMethod,
  contracts: Record<string, string>,
): Promise<ResolvedSignup[]> {
  // Sign up functions so users can subscribe. These L2 txs also advance the L2 chain,
  // which helps the sequencer include the pending L1->L2 bridge message.
  const functionsToSignupToFpc = await resolveFpcSignups(
    DEFAULTS.fpcSignups,
    contracts,
    DEFAULTS.fpcSignupDefaults,
  );

  const fpc = SubscriptionFPCContract.at(fpcAddress, wallet);

  for (const {
    addressKey,
    contractAddress,
    functionName,
    selector,
    maxUses,
    maxFee,
    maxUsers,
  } of functionsToSignupToFpc) {
    console.log(`\nSigning up ${addressKey}.${functionName} at index 0...`);
    await fpc.methods
      .sign_up(contractAddress, selector, 0, maxUses, maxFee, maxUsers)
      .send({ from: fpcDeployer, fee: { paymentMethod } });
    console.log(`${addressKey}.${functionName} sign_up done!`);
  }

  return functionsToSignupToFpc;
}

/**
 * Deploys a new SubscriptionFPC with fresh keys. The secret key is generated during
 * deployment and must be persisted (clients need it to decrypt the FPC's slot notes).
 */
async function deploySubscriptionFpc(
  wallet: EmbeddedWallet,
  deployer: AztecAddress,
  paymentMethod: SponsoredFeePaymentMethod,
): Promise<{ address: AztecAddress; secretKey: Fr }> {
  console.log("Deploying SubscriptionFPC...");
  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(wallet, deployer);
  const receipt = await deployment.send({ from: deployer, fee: { paymentMethod } });
  const address = receipt.contract.address;
  console.log("SubscriptionFPC deployed at:", address.toString());
  console.log("Secret key:", secretKey.toString());
  return { address, secretKey };
}

/** A sign-up spec with its selector computed and sponsorship params resolved. */
interface ResolvedSignup {
  addressKey: string;
  contractAddress: AztecAddress;
  functionName: string;
  selector: FunctionSelector;
  maxUses: number;
  maxFee: bigint;
  maxUsers: number;
}

/**
 * Resolves a list of FpcSignupSpecs into concrete (contractAddress, selector) tuples,
 * merging per-spec overrides with the defaults.
 */
async function resolveFpcSignups(
  specs: FpcSignupSpec[],
  contracts: Record<string, string>,
  defaults: { maxUses: number; maxFee: bigint; maxUsers: number },
): Promise<ResolvedSignup[]> {
  return Promise.all(
    specs.flatMap((spec) => {
      const fn = spec.artifact.functions.find((f) => f.name === spec.functionName);
      if (!fn) {
        throw new Error(
          `Function ${spec.functionName} not found in artifact ${spec.artifact.name}`,
        );
      }
      const maxUses = spec.maxUses ?? defaults.maxUses;
      const maxFee = spec.maxFee ?? defaults.maxFee;
      const maxUsers = spec.maxUsers ?? defaults.maxUsers;
      return spec.contractAlias.map(async (addressKey) => {
        const rawAddress = contracts[addressKey];
        if (!rawAddress) {
          throw new Error(`Address key "${addressKey}" not found in config.contracts`);
        }
        const contractAddress = AztecAddress.fromString(rawAddress);
        const selector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters);
        return {
          addressKey,
          contractAddress,
          functionName: spec.functionName,
          selector,
          maxUses,
          maxFee,
          maxUsers,
        };
      });
    }),
  );
}

/**
 * Builds the subscriptionFPC.functions map from resolved signups:
 * `{ contractAddress: { selectorHex: configIndex } }`.
 */
function buildFunctionsMap(resolved: ResolvedSignup[]): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {};
  for (const { contractAddress, selector } of resolved) {
    const key = contractAddress.toString();
    map[key] = map[key] ?? {};
    map[key][selector.toString()] = 0;
  }
  return map;
}

async function deployAndRegisterSubscriptionFpc(
  node: AztecNode,
  wallet: EmbeddedWallet,
  deployer: AztecAddress,
  paymentMethod: SponsoredFeePaymentMethod,
) {
  const { address: fpcAddress, secretKey } = await deploySubscriptionFpc(
    wallet,
    deployer,
    paymentMethod,
  );

  // `deployWithKeys` deploys with derived public keys (so the PXE knows the contract's
  // address + public keys), but never communicates the secret key to the PXE, it only
  // returns it to us. `sign_up` emits SlotNotes at `self.storage.slots.at(self.address)`
  // and calls `set_sender_for_tags(self.address)`, which requires the PXE to know the
  // secret key corresponding to the FPC's address so it can compute tagging secrets.
  //
  // We add the secret key to the already-registered instance via the third arg of
  // `registerContract`. Without this, `sign_up` later fails with "No public key registered for
  // address 0x...". TODO: push this step into gregojuice's `deployWithKeys` upstream so
  // callers don't need the follow-up.
  const fpcInstance = await node.getContract(fpcAddress);
  if (!fpcInstance) throw new Error("FPC contract not found on-chain after deploy");
  await wallet.registerContract(fpcInstance, SubscriptionFPCContractArtifact, secretKey);

  return { fpcAddress, secretKey };
}
