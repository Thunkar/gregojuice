import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

import { TokenContract } from "@gregojuice/aztec/artifacts/Token";
import { AMMContract } from "@gregojuice/aztec/artifacts/AMM";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";

import { ProofOfPasswordContract } from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { BatchCall } from "@aztec/aztec.js/contracts";

import {
  parseNetwork,
  parseAddressList,
  parsePaymentMode,
  NETWORK_URLS,
  setupWallet,
  getOrCreateDeployer,
  type NetworkName,
  type PaymentMode,
  type PaymentMethod,
} from "./utils.ts";

const INITIAL_TOKEN_BALANCE = 1_000_000_000n;

export interface SwapDeployOptions {
  network: NetworkName;
  /** If omitted, falls back to the per-network default. */
  paymentMode?: PaymentMode;
  /** Required. Used as the seed for the deterministic Proof-of-Password contract. */
  password: string;
  /**
   * Optional deterministic secret for the deployer account (hex-encoded Fr).
   * Falls back to `process.env.SECRET`, then to a random key. For e2e runs
   * this should be the swap-admin secret derived by global-setup.
   */
  deployerSecret?: string;
  /** Extra L2 addresses to mint initial token balances to. */
  mintTo?: string[];
  /** If true, skips writing `src/config/networks/<network>.json`. */
  skipWriteConfig?: boolean;
}

export interface SwapDeployResult {
  network: NetworkName;
  chainId: string;
  rollupVersion: string;
  deployerAddress: string;
  contracts: {
    gregoCoin: string;
    gregoCoinPremium: string;
    liquidityToken: string;
    amm: string;
    pop: string;
    sponsoredFPC: string;
    salt: string;
  };
  configPath: string | null;
}

async function deployContracts(
  wallet: EmbeddedWallet,
  deployer: AztecAddress,
  password: string,
  mintToAddresses: string[],
  paymentMethod?: PaymentMethod,
) {
  const contractAddressSalt = Fr.random();

  const { contract: gregoCoin } = await TokenContract.deploy(
    wallet,
    deployer,
    "GregoCoin",
    "GRG",
    18,
  ).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const { contract: gregoCoinPremium } = await TokenContract.deploy(
    wallet,
    deployer,
    "GregoCoinPremium",
    "GRGP",
    18,
  ).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const { contract: liquidityToken } = await TokenContract.deploy(
    wallet,
    deployer,
    "LiquidityToken",
    "LQT",
    18,
  ).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const { contract: amm } = await AMMContract.deploy(
    wallet,
    gregoCoin.address,
    gregoCoinPremium.address,
    liquidityToken.address,
  ).send({ from: deployer, fee: { paymentMethod }, contractAddressSalt, wait: { timeout: 120 } });

  const extraMints = mintToAddresses.flatMap((addr) => {
    const recipient = AztecAddress.fromString(addr);
    console.log(`Will mint ${INITIAL_TOKEN_BALANCE} GregoCoin + GregoCoinPremium to ${addr}`);
    return [
      gregoCoin.methods.mint_to_private(recipient, INITIAL_TOKEN_BALANCE),
      gregoCoinPremium.methods.mint_to_private(recipient, INITIAL_TOKEN_BALANCE),
    ];
  });

  await new BatchCall(wallet, [
    liquidityToken.methods.set_minter(amm.address, true),
    gregoCoin.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    gregoCoinPremium.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    ...extraMints,
  ]).send({ from: deployer, fee: { paymentMethod }, wait: { timeout: 120 } });

  const nonceForAuthwits = Fr.random();
  const token0Authwit = await wallet.createAuthWit(deployer, {
    caller: amm.address,
    call: await gregoCoin.methods
      .transfer_to_public_and_prepare_private_balance_increase(
        deployer,
        amm.address,
        INITIAL_TOKEN_BALANCE,
        nonceForAuthwits,
      )
      .getFunctionCall(),
  });
  const token1Authwit = await wallet.createAuthWit(deployer, {
    caller: amm.address,
    call: await gregoCoinPremium.methods
      .transfer_to_public_and_prepare_private_balance_increase(
        deployer,
        amm.address,
        INITIAL_TOKEN_BALANCE,
        nonceForAuthwits,
      )
      .getFunctionCall(),
  });

  await new BatchCall(wallet, [
    liquidityToken.methods.set_minter(amm.address, true),
    gregoCoin.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    gregoCoinPremium.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    amm.methods
      .add_liquidity(
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        nonceForAuthwits,
      )
      .with({ authWitnesses: [token0Authwit, token1Authwit] }),
  ]).send({ from: deployer, fee: { paymentMethod }, wait: { timeout: 120 } });

  const popDeployMethod = ProofOfPasswordContract.deploy(wallet, gregoCoin.address, password);

  // Address is computed lazily. This is bad
  await popDeployMethod.getInstance();

  const pop = ProofOfPasswordContract.at(popDeployMethod.address!, wallet);

  await new BatchCall(wallet, [
    await popDeployMethod.request({ contractAddressSalt, deployer }),
    gregoCoin.methods.set_minter(pop.address, true),
  ]).send({
    from: deployer,
    fee: { paymentMethod },
    wait: { timeout: 120 },
  });

  return {
    gregoCoinAddress: gregoCoin.address.toString(),
    gregoCoinPremiumAddress: gregoCoinPremium.address.toString(),
    liquidityTokenAddress: liquidityToken.address.toString(),
    ammAddress: amm.address.toString(),
    popAddress: pop.address.toString(),
    contractAddressSalt: contractAddressSalt.toString(),
  };
}

function writeNetworkConfig(
  network: NetworkName,
  nodeUrl: string,
  deploymentInfo: {
    chainId: string;
    rollupVersion: string;
    gregoCoinAddress: string;
    gregoCoinPremiumAddress: string;
    ammAddress: string;
    liquidityTokenAddress: string;
    popAddress: string;
    contractAddressSalt: string;
    deployerAddress: string;
  },
  sponsoredFPCAddress: string,
): string {
  const configDir = path.join(import.meta.dirname, "../src/config/networks");
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, `${network}.json`);
  const config = {
    id: network,
    nodeUrl,
    chainId: deploymentInfo.chainId,
    rollupVersion: deploymentInfo.rollupVersion,
    contracts: {
      gregoCoin: deploymentInfo.gregoCoinAddress,
      gregoCoinPremium: deploymentInfo.gregoCoinPremiumAddress,
      amm: deploymentInfo.ammAddress,
      liquidityToken: deploymentInfo.liquidityTokenAddress,
      pop: deploymentInfo.popAddress,
      sponsoredFPC: sponsoredFPCAddress,
      salt: deploymentInfo.contractAddressSalt,
    },
    deployer: {
      address: deploymentInfo.deployerAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`
      \n\n\n
      Contracts deployed successfully to ${network}!
      Network config saved to: ${configPath}

      Deployed contracts:
      - GregoCoin: ${deploymentInfo.gregoCoinAddress}
      - GregoCoinPremium: ${deploymentInfo.gregoCoinPremiumAddress}
      - AMM: ${deploymentInfo.ammAddress}
      - Liquidity Token: ${deploymentInfo.liquidityTokenAddress}
      - Proof of password: ${deploymentInfo.popAddress}

      Deployer: ${deploymentInfo.deployerAddress}
      \n\n\n
    `);

  return configPath;
}

/**
 * Programmatic entry point. Safe to import — does not read argv, exit the
 * process, or look at env vars other than `SECRET` (as a fallback for
 * `deployerSecret`).
 */
export async function runSwapDeploy(opts: SwapDeployOptions): Promise<SwapDeployResult> {
  const nodeUrl = NETWORK_URLS[opts.network];
  const { node, wallet, sponsoredFPC, paymentMethod } = await setupWallet(
    nodeUrl,
    opts.network,
    opts.paymentMode,
  );

  const { rollupVersion, l1ChainId: chainId } = await node.getNodeInfo();

  const deployer = await getOrCreateDeployer(wallet, paymentMethod, opts.deployerSecret);

  const contractDeploymentInfo = await deployContracts(
    wallet,
    deployer,
    opts.password,
    opts.mintTo ?? [],
    paymentMethod,
  );

  const deploymentInfo = {
    ...contractDeploymentInfo,
    chainId: chainId.toString(),
    rollupVersion: rollupVersion.toString(),
    deployerAddress: deployer.toString(),
  };

  const configPath = opts.skipWriteConfig
    ? null
    : writeNetworkConfig(opts.network, nodeUrl, deploymentInfo, sponsoredFPC.address.toString());

  return {
    network: opts.network,
    chainId: deploymentInfo.chainId,
    rollupVersion: deploymentInfo.rollupVersion,
    deployerAddress: deploymentInfo.deployerAddress,
    contracts: {
      gregoCoin: deploymentInfo.gregoCoinAddress,
      gregoCoinPremium: deploymentInfo.gregoCoinPremiumAddress,
      liquidityToken: deploymentInfo.liquidityTokenAddress,
      amm: deploymentInfo.ammAddress,
      pop: deploymentInfo.popAddress,
      sponsoredFPC: sponsoredFPC.address.toString(),
      salt: deploymentInfo.contractAddressSalt,
    },
    configPath,
  };
}

async function cli(): Promise<void> {
  const network = parseNetwork();
  const paymentMode = parsePaymentMode(network);
  const mintTo = parseAddressList("--mint-to", "MINT_TO");
  const password = process.env.PASSWORD;
  if (!password) throw new Error("Please specify a PASSWORD");

  await runSwapDeploy({ network, paymentMode, password, mintTo });
}

// Only run the CLI when invoked directly (not when imported).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  cli()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
