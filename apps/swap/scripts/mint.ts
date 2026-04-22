/**
 * Mint tokens to one or more addresses on an existing deployment.
 *
 * Usage:
 *   SWAP_ADMIN_SECRET=0x... node --experimental-transform-types scripts/mint.ts --network testnet --to 0xaddr1 --to 0xaddr2
 *   SWAP_ADMIN_SECRET=0x... MINT_TO=0xaddr1,0xaddr2 node --experimental-transform-types scripts/mint.ts --network testnet
 *
 * Requires SWAP_ADMIN_SECRET env var to reconstruct the deployer account (must match the original deployer).
 */

import fs from "fs";
import path from "path";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { TokenContract, TokenContractArtifact } from "@gregojuice/aztec/artifacts/Token";
import { BatchCall } from "@aztec/aztec.js/contracts";
import {
  parseNetwork,
  parseAddressList,
  NETWORK_URLS,
  setupWallet,
  loadOrCreateSecret,
  getAdmin,
} from "@gregojuice/common/testing";

const NETWORK = parseNetwork();
const MINT_TO = parseAddressList("--to", "MINT_TO");

if (MINT_TO.length === 0) {
  console.error("No addresses to mint to. Use --to <address> or MINT_TO env var.");
  process.exit(1);
}

if (!process.env.SWAP_ADMIN_SECRET) {
  console.error("SWAP_ADMIN_SECRET env var is required to reconstruct the deployer account.");
  process.exit(1);
}

const AMOUNT = process.env.AMOUNT ? BigInt(process.env.AMOUNT) : 1_000_000_000n;

// Load network config to get contract addresses
const configPath = path.join(import.meta.dirname, `../src/config/networks/${NETWORK}.json`);
if (!fs.existsSync(configPath)) {
  console.error(`Network config not found: ${configPath}. Run deploy first.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

async function main() {
  const nodeUrl = NETWORK_URLS[NETWORK];
  const { node, wallet, paymentMethod } = await setupWallet(nodeUrl, NETWORK);

  console.log("Reconstructing deployer account...");
  const { secretKey } = loadOrCreateSecret("SWAP_ADMIN_SECRET");
  const deployer = await getAdmin(
    wallet,
    secretKey,
    `Run \`yarn swap deploy-admin:${NETWORK}\` first.`,
  );
  console.log(`Deployer: ${deployer.toString()}`);

  // Verify deployer matches config
  if (deployer.toString() !== config.deployer.address) {
    console.error(
      `Deployer mismatch! Expected ${config.deployer.address}, got ${deployer.toString()}`,
    );
    console.error("Make sure SECRET matches the original deployment.");
    process.exit(1);
  }

  // Register token contracts
  const gregoCoinAddress = AztecAddress.fromString(config.contracts.gregoCoin);
  const gregoCoinPremiumAddress = AztecAddress.fromString(config.contracts.gregoCoinPremium);

  const [gregoCoinInstance, gregoCoinPremiumInstance] = await Promise.all([
    wallet.getContractMetadata(gregoCoinAddress).then((m) => m.instance),
    wallet.getContractMetadata(gregoCoinPremiumAddress).then((m) => m.instance),
  ]);

  // Register if not already registered
  if (!gregoCoinInstance) {
    const instance = await node.getContract(gregoCoinAddress);
    await wallet.registerContract(instance!, TokenContractArtifact);
  }
  if (!gregoCoinPremiumInstance) {
    const instance = await node.getContract(gregoCoinPremiumAddress);
    await wallet.registerContract(instance!, TokenContractArtifact);
  }

  const gregoCoin = TokenContract.at(gregoCoinAddress, wallet);
  const gregoCoinPremium = TokenContract.at(gregoCoinPremiumAddress, wallet);

  // Build mint calls
  const mintCalls = MINT_TO.flatMap((addr) => {
    const recipient = AztecAddress.fromString(addr);
    console.log(`Will mint ${AMOUNT} GregoCoin + GregoCoinPremium to ${addr}`);
    return [
      gregoCoin.methods.mint_to_private(recipient, AMOUNT),
      gregoCoinPremium.methods.mint_to_private(recipient, AMOUNT),
    ];
  });

  console.log(`Sending batch mint tx (${mintCalls.length} calls)...`);
  await new BatchCall(wallet, mintCalls).send({
    from: deployer,
    fee: { paymentMethod },
    wait: { timeout: 120 },
  });

  console.log("Done! Tokens minted successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
