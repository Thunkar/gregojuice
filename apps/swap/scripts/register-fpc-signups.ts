/**
 * Signs up the swap app's sponsored functions to an already-deployed
 * SubscriptionFPC, optionally running P75-based calibration to pick a tight
 * `maxFee` per signup.
 *
 * Inputs:
 *   --network <local|testnet>
 *   FPC_ADDRESS      — hex AztecAddress of the deployed FPC (from fpc-operator/deploy-fpc)
 *   FPC_ADMIN_SECRET — FPC admin secret (signup txs must be sent by the FPC deployer)
 *   FPC_SECRET       — the contract key secret the FPC was deployed with, so the
 *                      PXE can derive its public keys for note encoding during
 *                      calibration simulations. Published by deploy-fpc on stdout.
 *
 * Side outputs:
 *   Writes `subscriptionFPC.{address, secretKey, functions}` into the
 *   committed swap network config (`src/config/networks/<network>.json`).
 *   `functions` maps `contractAddress → { functionSelector → configIndex }`.
 *
 * Calibration behaviour:
 *   - `local`    : skipped. Uses the hardcoded `maxFee` fallback.
 *   - `testnet`  : runs the FPC's `calibrate` helper to get gas limits, then
 *                  multiplies by the clustec P75-of-last-2000-blocks maxFeePerGas
 *                  with a 2× safety multiplier (what the dashboard UI does).
 */
import fs from "fs";
import path from "path";
import type { FunctionAbi, ContractArtifact } from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { FunctionSelector } from "@aztec/stdlib/abi";
import { Fr } from "@aztec/foundation/curves/bn254";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "@gregojuice/aztec/artifacts/SubscriptionFPC";
import { ProofOfPasswordContractArtifact } from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { AMMContractArtifact } from "@gregojuice/aztec/artifacts/AMM";
import { TokenContractArtifact } from "@gregojuice/aztec/artifacts/Token";
import { SubscriptionFPC } from "@gregojuice/aztec/subscription-fpc";
import { fetchFeeStats, computeMaxFeeFromP75 } from "@gregojuice/common/fee-stats";

import {
  parseNetwork,
  NETWORK_URLS,
  setupWallet,
  loadOrCreateSecret,
  getOrCreateAdmin,
  type NetworkName,
} from "@gregojuice/common/testing";

const P75_BLOCK_RANGE = 2000;
const P75_MULTIPLIER = 2;

/** Default sponsorship policy; individual specs can override any field. */
const SIGNUP_POLICY = {
  maxUses: 100,
  maxUsers: 100,
  /** Used when calibration is skipped (local) or as a floor. */
  fallbackMaxFee: BigInt("1000000000000000000000"), // 1000 FJ
} as const;

type SampleArgsBuilder = (ctx: {
  admin: AztecAddress;
  contractAddress: AztecAddress;
  contracts: Record<string, AztecAddress>;
}) => unknown[];

interface SignupSpec {
  artifact: ContractArtifact;
  functionName: string;
  /** Aliases into `config.contracts` — each one produces a separate sign_up. */
  contractAlias: string[];
  /** Args to pass when simulating the call during calibration. */
  sampleArgs: SampleArgsBuilder;
  maxUses?: number;
  maxUsers?: number;
}

const SIGNUPS: SignupSpec[] = [
  {
    artifact: ProofOfPasswordContractArtifact,
    functionName: "check_password_and_mint",
    contractAlias: ["pop"],
    // PoP contract function signature: (password: Field, to: AztecAddress, amount: u128)
    // Admin passes their own password seed (0 for test runs); mint to self.
    sampleArgs: ({ admin }) => ["0x0", admin.toString(), 10n],
  },
  {
    artifact: AMMContractArtifact,
    functionName: "swap_tokens_for_exact_tokens_from",
    contractAlias: ["amm"],
    // AMM swap uses amountIn=10 + amountOutMin=0. Tokens need to be already minted to admin.
    sampleArgs: ({ admin, contracts }) => [
      admin.toString(),
      contracts.gregoCoin.toString(),
      contracts.gregoCoinPremium.toString(),
      10n,
      0n,
      Fr.random().toString(),
    ],
  },
  {
    artifact: TokenContractArtifact,
    functionName: "transfer_in_private_deliver_offchain",
    contractAlias: ["gregoCoin", "gregoCoinPremium"],
    sampleArgs: ({ admin }) => [admin.toString(), admin.toString(), 10n, 0n, "0x"],
  },
];

async function main() {
  const network = parseNetwork();
  const configPath = path.join(import.meta.dirname, `../src/config/networks/${network}.json`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const fpcAddress = AztecAddress.fromString(requireEnv("FPC_ADDRESS"));
  console.error(`Registering swap signups on FPC ${fpcAddress.toString()}...`);

  const { node, wallet, paymentMethod } = await setupWallet(NETWORK_URLS[network], network);
  // Signups must be sent by the FPC admin (who deployed the FPC), not the swap admin.
  // The FPC admin is funded + deployed by `fpc-operator/scripts/fund-fpc-admin.ts`.
  const { secretKey } = loadOrCreateSecret("FPC_ADMIN_SECRET");
  const admin = await getOrCreateAdmin(wallet, secretKey, paymentMethod);

  // Hydrate the PXE with all swap contracts + register the admin as its own sender
  // so simulating calibration calls works (the admin is both caller and subject).
  const contracts = await registerSwapContracts(wallet, node, config.contracts);
  await wallet.registerSender(admin, "swap-admin");

  // Register the FPC contract so we can simulate subscribe() against it.
  const fpcInstance = await node.getContract(fpcAddress);
  if (!fpcInstance) throw new Error(`FPC ${fpcAddress.toString()} not found on-chain`);
  // The FPC's contract key secret is published by deploy-fpc (it's public by
  // design — the FPC holds notes for its slot tracking and the PXE needs its
  // keys to decode those notes during simulation).
  const fpcSecret = Fr.fromString(requireEnv("FPC_SECRET"));
  await wallet.registerContract(fpcInstance, SubscriptionFPCContractArtifact, fpcSecret);

  const fpc = new SubscriptionFPC(SubscriptionFPCContract.at(fpcAddress, wallet));

  const resolved = await resolveSignups(SIGNUPS, contracts);
  // Matches the shape the swap app expects at runtime:
  // { [contractAddress]: { [functionSelector]: configIndex } }.
  // See apps/swap/src/config/networks/index.ts → SubscriptionFPCConfig.
  const functions: Record<string, Record<string, number>> = {};

  for (const signup of resolved) {
    console.error(`\nSigning up ${signup.aliasKey}.${signup.functionName}...`);

    const maxFee = await pickMaxFee({ network, fpc, wallet, admin, node, signup, contracts });

    await fpc.contract.methods
      .sign_up(
        signup.contractAddress,
        signup.selector,
        0, // configIndex
        signup.maxUses,
        maxFee,
        signup.maxUsers,
      )
      .send({ from: admin, fee: { paymentMethod } });

    console.error(`  sign_up ok — maxFee=${maxFee}`);

    const key = signup.contractAddress.toString();
    functions[key] = functions[key] ?? {};
    functions[key][signup.selector.toString()] = 0;
  }

  config.subscriptionFPC = {
    ...(config.subscriptionFPC ?? {}),
    address: fpcAddress.toString(),
    secretKey: fpcSecret.toString(),
    functions,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.error(`\nUpdated ${configPath} with subscriptionFPC.functions.`);
}

// ── Helpers ─────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} env var is required`);
    process.exit(1);
  }
  return v;
}

async function registerSwapContracts(
  wallet: import("@aztec/wallets/embedded").EmbeddedWallet,
  node: import("@aztec/aztec.js/node").AztecNode,
  contracts: Record<string, string>,
): Promise<Record<string, AztecAddress>> {
  // Map alias → artifact so we can register everything the sample calls touch.
  const ARTIFACT_BY_ALIAS: Record<string, ContractArtifact> = {
    gregoCoin: TokenContractArtifact,
    gregoCoinPremium: TokenContractArtifact,
    liquidityToken: TokenContractArtifact,
    amm: AMMContractArtifact,
    pop: ProofOfPasswordContractArtifact,
  };

  const out: Record<string, AztecAddress> = {};
  for (const [alias, addressStr] of Object.entries(contracts)) {
    const artifact = ARTIFACT_BY_ALIAS[alias];
    if (!artifact) continue; // ignore config entries we don't know about (sponsoredFPC etc)
    const address = AztecAddress.fromString(addressStr);
    const instance = await node.getContract(address);
    if (!instance) {
      throw new Error(`Contract ${alias} (${addressStr}) not found on-chain`);
    }
    await wallet.registerContract(instance, artifact);
    out[alias] = address;
  }
  return out;
}

interface ResolvedSignup extends SignupSpec {
  aliasKey: string;
  contractAddress: AztecAddress;
  selector: FunctionSelector;
  maxUses: number;
  maxUsers: number;
}

async function resolveSignups(
  specs: SignupSpec[],
  contracts: Record<string, AztecAddress>,
): Promise<ResolvedSignup[]> {
  const out: ResolvedSignup[] = [];
  for (const spec of specs) {
    const fn = spec.artifact.functions.find((f: FunctionAbi) => f.name === spec.functionName);
    if (!fn) {
      throw new Error(`Function ${spec.functionName} not found in ${spec.artifact.name}`);
    }
    const selector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters);
    for (const alias of spec.contractAlias) {
      const contractAddress = contracts[alias];
      if (!contractAddress) {
        throw new Error(`Alias ${alias} missing from config.contracts`);
      }
      out.push({
        ...spec,
        aliasKey: alias,
        contractAddress,
        selector,
        maxUses: spec.maxUses ?? SIGNUP_POLICY.maxUses,
        maxUsers: spec.maxUsers ?? SIGNUP_POLICY.maxUsers,
      });
    }
  }
  return out;
}

async function pickMaxFee(params: {
  network: NetworkName;
  fpc: SubscriptionFPC;
  wallet: import("@aztec/wallets/embedded").EmbeddedWallet;
  admin: AztecAddress;
  node: import("@aztec/aztec.js/node").AztecNode;
  signup: ResolvedSignup;
  contracts: Record<string, AztecAddress>;
}): Promise<bigint> {
  const { network, fpc, wallet, admin, node, signup, contracts } = params;
  if (network === "local") {
    return SIGNUP_POLICY.fallbackMaxFee;
  }

  // Build a realistic sample call to measure gas on.
  const contract = Contract.at(signup.contractAddress, signup.artifact, wallet);
  const args = signup.sampleArgs({
    admin,
    contractAddress: signup.contractAddress,
    contracts,
  });
  const sampleCall = await contract.methods[signup.functionName](...args).getFunctionCall();

  const { estimatedGas } = await fpc.helpers.calibrate({
    adminWallet: wallet,
    adminAddress: admin,
    node,
    sampleCall,
  });

  const stats = await fetchFeeStats(network, P75_BLOCK_RANGE);
  const maxFee = computeMaxFeeFromP75(
    { daGas: Number(estimatedGas.gasLimits.daGas), l2Gas: Number(estimatedGas.gasLimits.l2Gas) },
    {
      daGas: Number(estimatedGas.teardownGasLimits.daGas),
      l2Gas: Number(estimatedGas.teardownGasLimits.l2Gas),
    },
    stats,
    P75_MULTIPLIER,
  );

  return maxFee > SIGNUP_POLICY.fallbackMaxFee ? maxFee : SIGNUP_POLICY.fallbackMaxFee;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
