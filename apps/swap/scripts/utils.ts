import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getPXEConfig } from "@aztec/pxe/server";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { Fr } from "@aztec/foundation/curves/bn254";
import { FeeJuicePaymentMethod, SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
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

// ── Payment modes ────────────────────────────────────────────────────

export const VALID_PAYMENT_MODES = ["feejuice", "sponsoredfpc"] as const;
export type PaymentMode = (typeof VALID_PAYMENT_MODES)[number];

/** Default payment mode per network if --payment is omitted. */
const DEFAULT_PAYMENT_MODE: Record<NetworkName, PaymentMode> = {
  local: "sponsoredfpc",
  devnet: "sponsoredfpc",
  nextnet: "sponsoredfpc",
  testnet: "feejuice",
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

/**
 * Parses `--payment <feejuice|sponsoredfpc>` from argv. If omitted, falls back
 * to the network default (sponsoredfpc for sandbox/devnet/nextnet, feejuice for testnet).
 */
export function parsePaymentMode(network: NetworkName): PaymentMode {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--payment");
  if (idx === -1 || idx === args.length - 1) return DEFAULT_PAYMENT_MODE[network];
  const mode = args[idx + 1];
  if (!VALID_PAYMENT_MODES.includes(mode as PaymentMode)) {
    console.error(
      `Invalid --payment mode: ${mode}. Must be one of: ${VALID_PAYMENT_MODES.join(", ")}`,
    );
    process.exit(1);
  }
  return mode as PaymentMode;
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

/**
 * Builds a payment method for the given mode.
 *
 * - `sponsoredfpc`: returns a `SponsoredFeePaymentMethod` pointing at the
 *   sandbox-provided SponsoredFPC.
 * - `feejuice`: returns a `FeeJuicePaymentMethod` that pays out of the given
 *   payer's native FJ balance. The payer must have FJ before calling this.
 *
 * Returns `undefined` when no payment method applies (legacy callers assumed
 * that `undefined` → wallet chooses; kept for backwards compatibility).
 */
export function buildPaymentMethod(
  mode: PaymentMode,
  sponsoredFPCAddress: AztecAddress,
  feeJuicePayer: AztecAddress,
) {
  if (mode === "feejuice") return new FeeJuicePaymentMethod(feeJuicePayer);
  return new SponsoredFeePaymentMethod(sponsoredFPCAddress);
}

export interface SetupWalletResult {
  node: AztecNode;
  wallet: EmbeddedWallet;
  sponsoredFPC: Awaited<ReturnType<typeof getSponsoredFPCContract>>;
  paymentMode: PaymentMode;
  /**
   * Payment method ready to use as soon as the deployer is known. Call
   * `resolvePaymentMethod(deployer)` after `getOrCreateDeployer` to get the
   * real one — needed because `FeeJuicePaymentMethod` wants the payer address.
   */
  resolvePaymentMethod: (
    payer: AztecAddress,
  ) => FeeJuicePaymentMethod | SponsoredFeePaymentMethod;
}

export async function setupWallet(
  nodeUrl: string,
  network: NetworkName,
  paymentMode: PaymentMode = parsePaymentMode(network),
): Promise<SetupWalletResult> {
  const node = createAztecNodeClient(nodeUrl);
  const proverEnabled = network !== "local";
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled },
  });

  const sponsoredFPC = await getSponsoredFPCContract();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

  return {
    node,
    wallet,
    sponsoredFPC,
    paymentMode,
    resolvePaymentMethod: (payer) => buildPaymentMethod(paymentMode, sponsoredFPC.address, payer),
  };
}

/**
 * Reconstructs the deployer account from SECRET env var (deterministic)
 * or creates a new random one. Returns the address.
 *
 * `paymentMethodForInit` can be a prebuilt method (sponsoredfpc path) or a
 * callback receiving the computed deployer address — needed for feejuice
 * mode, where the deployer pays for its own init tx.
 */
export async function getOrCreateDeployer(
  wallet: EmbeddedWallet,
  paymentMethodForInit?:
    | FeeJuicePaymentMethod
    | SponsoredFeePaymentMethod
    | ((deployer: AztecAddress) => FeeJuicePaymentMethod | SponsoredFeePaymentMethod),
): Promise<AztecAddress> {
  const salt = new Fr(0);
  const secretKey = process.env.SECRET ? Fr.fromString(process.env.SECRET) : await Fr.random();
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);

  if (initializationStatus !== ContractInitializationStatus.INITIALIZED) {
    const paymentMethod =
      typeof paymentMethodForInit === "function"
        ? paymentMethodForInit(accountManager.address)
        : paymentMethodForInit;
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
