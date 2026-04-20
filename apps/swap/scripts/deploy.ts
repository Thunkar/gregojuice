import fs from "fs";
import path from "path";

import { TokenContract } from "@gregojuice/aztec/artifacts/Token";
import { AMMContract } from "@gregojuice/aztec/artifacts/AMM";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { FeeJuicePaymentMethod, SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";

import { ProofOfPasswordContract } from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { BatchCall } from "@aztec/aztec.js/contracts";

import {
  parseNetwork,
  parseAddressList,
  NETWORK_URLS,
  setupWallet,
  getOrCreateDeployer,
} from "./utils.ts";

type PaymentMethod = FeeJuicePaymentMethod | SponsoredFeePaymentMethod;

const NETWORK = parseNetwork();
const MINT_TO_ADDRESSES = parseAddressList("--mint-to", "MINT_TO");
const AZTEC_NODE_URL = NETWORK_URLS[NETWORK];

const PASSWORD = process.env.PASSWORD;
if (!PASSWORD) {
  throw new Error("Please specify a PASSWORD");
}

const INITIAL_TOKEN_BALANCE = 1_000_000_000n;

async function deployContracts(
  wallet: EmbeddedWallet,
  deployer: AztecAddress,
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

  const extraMints = MINT_TO_ADDRESSES.flatMap((addr) => {
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

  const popDeployMethod = ProofOfPasswordContract.deploy(wallet, gregoCoin.address, PASSWORD);

  // Address is computed lazily. This is bad
  await popDeployMethod.getInstance();

  const pop = ProofOfPasswordContract.at(popDeployMethod.address, wallet);

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

async function writeNetworkConfig(
  network: string,
  deploymentInfo: any,
  sponsoredFPCAddress: string,
) {
  const configDir = path.join(import.meta.dirname, "../src/config/networks");
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, `${network}.json`);
  const config = {
    id: network,
    nodeUrl: AZTEC_NODE_URL,
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
}

async function main() {
  const { node, wallet, sponsoredFPC, resolvePaymentMethod } = await setupWallet(
    AZTEC_NODE_URL,
    NETWORK,
  );

  const { rollupVersion, l1ChainId: chainId } = await node.getNodeInfo();

  // In feejuice mode the deployer pays for its own init tx — caller must
  // have bridged FJ to this address before invoking the script.
  const deployer = await getOrCreateDeployer(wallet, resolvePaymentMethod);
  const paymentMethod = resolvePaymentMethod(deployer);

  const contractDeploymentInfo = await deployContracts(wallet, deployer, paymentMethod);
  const deploymentInfo = {
    ...contractDeploymentInfo,
    chainId: chainId.toString(),
    rollupVersion: rollupVersion.toString(),
    deployerAddress: deployer.toString(),
  };

  await writeNetworkConfig(NETWORK, deploymentInfo, sponsoredFPC.address.toString());

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
