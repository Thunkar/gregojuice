import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getPXEConfig } from "@aztec/pxe/server";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { Fr } from "@aztec/foundation/curves/bn254";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { NO_FROM } from "@aztec/aztec.js/account";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";

// ── Network configuration ────────────────────────────────────────────

export const VALID_NETWORKS = ["local", "devnet", "nextnet", "testnet"] as const;
export type NetworkName = (typeof VALID_NETWORKS)[number];

export const NETWORK_URLS: Record<NetworkName, string> = {
  local: "http://localhost:8080",
  devnet: "https://v4-devnet-2.aztec-labs.com",
  nextnet: "https://nextnet.aztec-labs.com",
  testnet: "https://rpc.testnet.aztec-labs.com",
};

// ── CLI parsing ──────────────────────────────────────────────────────

export function parseNetwork(): NetworkName {
  const args = process.argv.slice(2);
  const networkIndex = args.indexOf("--network");
  if (networkIndex === -1 || networkIndex === args.length - 1) {
    console.error(`Usage: ... --network <${VALID_NETWORKS.join("|")}>`);
    process.exit(1);
  }
  const network = args[networkIndex + 1];
  if (!VALID_NETWORKS.includes(network as NetworkName)) {
    console.error(`Invalid network: ${network}. Must be one of: ${VALID_NETWORKS.join(", ")}`);
    process.exit(1);
  }
  return network as NetworkName;
}

export function parseAddressList(flag: string, envVar?: string): string[] {
  const args = process.argv.slice(2);
  const addresses: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === flag && i + 1 < args.length) {
      addresses.push(args[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  if (envVar && process.env[envVar]) {
    addresses.push(
      ...process.env[envVar]!.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return addresses;
}

// ── Wallet setup ─────────────────────────────────────────────────────

export async function getSponsoredFPCContract() {
  return getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
}

export function getPaymentMethod(network: NetworkName, sponsoredFPCAddress: AztecAddress) {
  return network !== "testnet" ? new SponsoredFeePaymentMethod(sponsoredFPCAddress) : undefined;
}

export async function setupWallet(nodeUrl: string, network: NetworkName) {
  const node = createAztecNodeClient(nodeUrl);
  const proverEnabled = network !== "local";
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled },
  });

  const sponsoredFPC = await getSponsoredFPCContract();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

  const paymentMethod = getPaymentMethod(network, sponsoredFPC.address);

  return { node, wallet, paymentMethod, sponsoredFPC };
}

/**
 * Reconstructs the deployer account from SECRET env var (deterministic)
 * or creates a new random one. Returns the address.
 */
export async function getOrCreateDeployer(
  wallet: EmbeddedWallet,
  paymentMethod?: SponsoredFeePaymentMethod,
): Promise<AztecAddress> {
  const salt = new Fr(0);
  const secretKey = process.env.SECRET ? Fr.fromString(process.env.SECRET) : await Fr.random();
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);

  if (initializationStatus !== ContractInitializationStatus.INITIALIZED) {
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
      from: NO_FROM,
      fee: { paymentMethod },
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: 120 },
    });
  }

  return accountManager.address;
}
