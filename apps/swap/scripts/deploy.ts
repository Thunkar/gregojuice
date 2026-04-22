import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

import { TokenContract, TokenContractArtifact } from "@gregojuice/aztec/artifacts/Token";
import { AMMContract, AMMContractArtifact } from "@gregojuice/aztec/artifacts/AMM";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";

import {
  ProofOfPasswordContract,
  ProofOfPasswordContractArtifact,
} from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { BatchCall, NO_WAIT, type DeployOptions, type WaitOpts } from "@aztec/aztec.js/contracts";
import { waitForTx, type AztecNode } from "@aztec/aztec.js/node";

import {
  parseNetwork,
  parseAddressList,
  parsePaymentMode,
  NETWORK_URLS,
  setupWallet,
  loadOrCreateSecret,
  getAdmin,
  getSalt,
  type NetworkName,
  type PaymentMode,
  type PaymentMethod,
} from "@gregojuice/common/testing";
import { TxStatus } from "@aztec/stdlib/tx";

const INITIAL_TOKEN_BALANCE = 1_000_000_000n;

export interface SwapDeployOptions {
  network: NetworkName;
  /** If omitted, falls back to the per-network default. */
  paymentMode?: PaymentMode;
  /** Required. Used as the seed for the deterministic Proof-of-Password contract. */
  password: string;
  /**
   * Optional deterministic secret for the deployer account (hex-encoded Fr).
   * Falls back to `process.env.SWAP_ADMIN_SECRET`, then to a random key. For e2e runs
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
  node: AztecNode,
  deployer: AztecAddress,
  password: string,
  mintToAddresses: string[],
  paymentMethod?: PaymentMethod,
) {
  const contractAddressSalt = getSalt();

  // ── Build every deployment method + derive its deterministic address ──
  //
  // The AMM depends on token addresses, so tokens must resolve first. PoP
  // depends on GregoCoin. Everything uses the same salt so re-runs with the
  // same admin + SALT produce the same addresses and can be skipped.
  const gregoCoinDeploy = TokenContract.deploy(wallet, deployer, "GregoCoin", "GRG", 18);
  const gregoCoinPremiumDeploy = TokenContract.deploy(
    wallet,
    deployer,
    "GregoCoinPremium",
    "GRGP",
    18,
  );
  const liquidityTokenDeploy = TokenContract.deploy(wallet, deployer, "LiquidityToken", "LQT", 18);

  // `deployer` has to be passed explicitly to getInstance — it defaults to
  // AztecAddress.ZERO, which would produce an address different from the
  // one the eventual .send({ from: deployer }) writes to chain. See
  // DeployMethod.getInstance in aztec.js for the default.
  const instanceOpts = { contractAddressSalt, deployer };
  const gregoCoinInstance = await gregoCoinDeploy.getInstance(instanceOpts);
  const gregoCoinPremiumInstance = await gregoCoinPremiumDeploy.getInstance(instanceOpts);
  const liquidityTokenInstance = await liquidityTokenDeploy.getInstance(instanceOpts);

  const ammDeploy = AMMContract.deploy(
    wallet,
    gregoCoinInstance.address,
    gregoCoinPremiumInstance.address,
    liquidityTokenInstance.address,
  );
  const ammInstance = await ammDeploy.getInstance(instanceOpts);

  const popDeploy = ProofOfPasswordContract.deploy(wallet, gregoCoinInstance.address, password);
  const popInstance = await popDeploy.getInstance(instanceOpts);

  await Promise.all([
    wallet.registerContract(gregoCoinInstance, TokenContractArtifact),
    wallet.registerContract(gregoCoinPremiumInstance, TokenContractArtifact),
    wallet.registerContract(liquidityTokenInstance, TokenContractArtifact),
    wallet.registerContract(ammInstance, AMMContractArtifact),
    wallet.registerContract(popInstance, ProofOfPasswordContractArtifact),
  ]);

  // ── Gate deploys on what's already on-chain ─────────────────────────
  //
  // registerContract is idempotent + fast, so we always register. Deploy is
  // only sent when node.getContract returns null for that address.
  const [gregoCoinExists, gregoCoinPremiumExists, liquidityTokenExists, ammExists, popExists] =
    await Promise.all([
      node.getContract(gregoCoinInstance.address),
      node.getContract(gregoCoinPremiumInstance.address),
      node.getContract(liquidityTokenInstance.address),
      node.getContract(ammInstance.address),
      node.getContract(popInstance.address),
    ]);

  const { isContractClassPubliclyRegistered: isTokenPubliclyRegistered } =
    await wallet.getContractClassMetadata(gregoCoinInstance.currentContractClassId);

  const currentMinFees = await node.getCurrentMinFees();
  const baseOpts: DeployOptions<WaitOpts> = {
    from: deployer,
    fee: { paymentMethod, gasSettings: { maxFeesPerGas: currentMinFees.mul(10) } },
    contractAddressSalt,
    wait: { timeout: 120, waitForStatus: TxStatus.PROPOSED },
  };

  // In a fresh chain (local network) we deploy the first token so class registration
  // is done before the other deployments happen
  if (!isTokenPubliclyRegistered) {
    await gregoCoinDeploy.send(baseOpts);
  }

  // Fire every missing deploy in parallel with NO_WAIT so simulate+prove+
  // submit pipelines, then await all tx hashes at the end. The deploys
  // don't depend on each other being *mined* — AMM/PoP need the token
  // *addresses*, which are already known deterministically.
  //
  // Each .send must be called with `{ wait: NO_WAIT }` inline so TypeScript
  // picks the TxSendResultImmediate overload (which exposes `txHash`). A
  // wrapped helper would widen the option type and fall back to the default
  // `DeployResultMined` overload.
  const pending = [
    gregoCoinExists || !isTokenPubliclyRegistered
      ? null
      : gregoCoinDeploy.send({ ...baseOpts, wait: NO_WAIT }),
    gregoCoinPremiumExists ? null : gregoCoinPremiumDeploy.send({ ...baseOpts, wait: NO_WAIT }),
    liquidityTokenExists ? null : liquidityTokenDeploy.send({ ...baseOpts, wait: NO_WAIT }),
    ammExists ? null : ammDeploy.send({ ...baseOpts, wait: NO_WAIT }),
    popExists ? null : popDeploy.send({ ...baseOpts, wait: NO_WAIT }),
  ].filter((p): p is Exclude<typeof p, null> => p !== null);
  const sent = await Promise.all(pending);
  await Promise.all(
    sent.map((r) => waitForTx(node, r.txHash, { waitForStatus: TxStatus.PROPOSED, timeout: 120 })),
  );

  const gregoCoin = TokenContract.at(gregoCoinInstance.address, wallet);
  const gregoCoinPremium = TokenContract.at(gregoCoinPremiumInstance.address, wallet);
  const liquidityToken = TokenContract.at(liquidityTokenInstance.address, wallet);
  const amm = AMMContract.at(ammInstance.address, wallet);
  const pop = ProofOfPasswordContract.at(popInstance.address, wallet);

  // ── Post-deploy seeding ─────────────────────────────────────────────
  //
  // Anything that mutates state — minting, authwits, liquidity seed, PoP
  // minter binding — must only run on a fresh deploy. Re-running an authwit
  // would re-emit the same nullifier; re-seeding the AMM would double its
  // pool.
  if (!ammExists) {
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
    ]).send(baseOpts);

    const nonceForAuthwits = Fr.random();
    const [token0Authwit, token1Authwit] = await Promise.all(
      [gregoCoin, gregoCoinPremium].map(async (token) =>
        wallet.createAuthWit(deployer, {
          caller: amm.address,
          call: await token.methods
            .transfer_to_public_and_prepare_private_balance_increase(
              deployer,
              amm.address,
              INITIAL_TOKEN_BALANCE,
              nonceForAuthwits,
            )
            .getFunctionCall(),
        }),
      ),
    );

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
    ]).send(baseOpts);
  }

  if (!popExists) {
    await gregoCoin.methods.set_minter(pop.address, true).send(baseOpts);
  }

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

  const { secretKey } = opts.deployerSecret
    ? { secretKey: Fr.fromString(opts.deployerSecret) }
    : loadOrCreateSecret("SWAP_ADMIN_SECRET");
  const deployer = await getAdmin(
    wallet,
    secretKey,
    `Run \`yarn swap deploy-admin:${opts.network}\` first.`,
  );

  const contractDeploymentInfo = await deployContracts(
    wallet,
    node,
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
  const password = process.env.PASSWORD ?? "potato";

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
