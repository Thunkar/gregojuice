/**
 * Shared CLI / deploy-script plumbing for the app scripts folders.
 *
 * Importers are Node-only — this module pulls in PXE + aztec.js + @aztec/accounts
 * which aren't browser-safe. The `@gregojuice/common/testing` subpath export
 * keeps it out of the default browser bundle entry.
 */
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
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";

// ── Network configuration ────────────────────────────────────────────

export const VALID_NETWORKS = ["local", "testnet"] as const;
export type NetworkName = (typeof VALID_NETWORKS)[number];

export const NETWORK_URLS: Record<NetworkName, string> = {
  local: "http://localhost:8080",
  testnet: "https://rpc.testnet.aztec-labs.com",
};

/** L1 parameters the bridging scripts need. Keep in sync with the rollup. */
export const L1_DEFAULTS: Record<NetworkName, { l1RpcUrl: string; l1ChainId: number }> = {
  local: { l1RpcUrl: "http://localhost:8545", l1ChainId: 31337 },
  testnet: { l1RpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", l1ChainId: 11155111 },
};

/**
 * Anvil's first pre-funded dev key — used only for `local`. Published and
 * non-secret; lets CI + dev loops work with zero configuration.
 */
export const LOCAL_L1_FUNDER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Picks the L1 funder key + bridge mint flag for the target network.
 *
 *   L1_FUNDER_KEY env set   → use it, skip the mint (caller holds FJ on L1).
 *   local, env unset        → anvil dev key signs the tx (it has ETH for gas),
 *                             but we mint FJ via the fee-asset handler so the
 *                             dev key doesn't need a pre-funded FJ balance.
 *   non-local, env unset    → generate an ephemeral L1 key and mint via the
 *                             faucet (no external L1 funding required).
 */
export function resolveL1Funder(network: NetworkName): {
  l1FunderKey: `0x${string}` | undefined;
  mint: boolean;
} {
  const env = process.env.L1_FUNDER_KEY as `0x${string}` | undefined;
  if (env) return { l1FunderKey: env, mint: false };
  if (network === "local") return { l1FunderKey: LOCAL_L1_FUNDER_KEY as `0x${string}`, mint: true };
  return { l1FunderKey: undefined, mint: true };
}

/**
 * `local` can cheat-warp L1+L2 time to force the L1→L2 message through;
 * every other network just polls for inclusion.
 */
export function bridgeMode(network: NetworkName): "warp" | "poll" {
  return network === "local" ? "warp" : "poll";
}

// ── Payment modes ────────────────────────────────────────────────────

export const VALID_PAYMENT_MODES = ["feejuice", "sponsoredfpc"] as const;
export type PaymentMode = (typeof VALID_PAYMENT_MODES)[number];

/** Default payment mode per network if `--payment` is omitted. */
const DEFAULT_PAYMENT_MODE: Record<NetworkName, PaymentMode> = {
  local: "sponsoredfpc",
  testnet: "feejuice",
};

// ── CLI parsing ──────────────────────────────────────────────────────

export function parseNetwork(): NetworkName {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--network");
  if (idx === -1 || idx === args.length - 1) {
    console.error(`Usage: ... --network <${VALID_NETWORKS.join("|")}>`);
    process.exit(1);
  }
  const network = args[idx + 1];
  if (!VALID_NETWORKS.includes(network as NetworkName)) {
    console.error(`Invalid network: ${network}. Must be one of: ${VALID_NETWORKS.join(", ")}`);
    process.exit(1);
  }
  return network as NetworkName;
}

/**
 * Parses `--payment <feejuice|sponsoredfpc>` from argv, falling back to the
 * network default (sponsoredfpc on `local`, feejuice on `testnet`).
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

/**
 * Collects repeated `--flag <value>` occurrences plus an optional comma-
 * separated env-var list into a single array. Used by `mint.ts` etc.
 */
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
 * Builds the payment method for a given mode.
 *
 * - `sponsoredfpc`: `SponsoredFeePaymentMethod` pointing at the sandbox
 *   SponsoredFPC. Used when the account has no fee juice.
 * - `feejuice`:     `undefined` — the wallet will pay out of the account's
 *   own FJ balance by default. The account must be funded beforehand.
 */
export type PaymentMethod = SponsoredFeePaymentMethod | undefined;

export function buildPaymentMethod(
  mode: PaymentMode,
  sponsoredFPCAddress: AztecAddress,
): PaymentMethod {
  if (mode === "feejuice") return undefined;
  return new SponsoredFeePaymentMethod(sponsoredFPCAddress);
}

export interface SetupWalletResult {
  node: AztecNode;
  wallet: EmbeddedWallet;
  sponsoredFPC: Awaited<ReturnType<typeof getSponsoredFPCContract>>;
  paymentMode: PaymentMode;
  paymentMethod: PaymentMethod;
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
    paymentMethod: buildPaymentMethod(paymentMode, sponsoredFPC.address),
  };
}

// ── Admin key handling ───────────────────────────────────────────────

/**
 * Reads an admin secret from the named env var, generating a fresh one only
 * when absent. The caller is expected to surface the generated secret back
 * to the operator (typically as `export NAME=…` on stdout) so it can be
 * re-exported for subsequent runs.
 */
export function loadOrCreateSecret(envVar: string): { secretKey: Fr; generated: boolean } {
  const env = process.env[envVar];
  if (env) return { secretKey: Fr.fromString(env), generated: false };
  return { secretKey: Fr.random(), generated: true };
}

/**
 * Universal salt read from the `SALT` env var, defaulting to `Fr(0)` when
 * unset. Used for admin schnorr account salts, swap contract address salt,
 * FPC contract address salt — everything that needs a salt to give
 * reproducible deployments across re-runs.
 */
export function getSalt(): Fr {
  const env = process.env.SALT;
  return env ? Fr.fromString(env) : new Fr(0);
}

/**
 * Computes the deterministic L2 address of a schnorr admin account without
 * touching the chain. Uses the `SALT` env var (defaults to 0) so callers
 * that override the universal salt see the right address.
 */
export async function deriveSchnorrAdminAddress(secretKey: Fr): Promise<AztecAddress> {
  return getSchnorrAccountContractAddress(secretKey, getSalt());
}

/**
 * Registers the admin schnorr account in the wallet (PXE) and, if it hasn't
 * been initialised on-chain yet, sends the deploy tx. Returns its address.
 *
 * `paymentMethod` covers the init tx when required. In `feejuice` mode pass
 * `undefined` — the admin must already be funded.
 */
export async function getOrCreateAdmin(
  wallet: EmbeddedWallet,
  secretKey: Fr,
  paymentMethod?: PaymentMethod,
): Promise<AztecAddress> {
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, getSalt(), signingKey);

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
