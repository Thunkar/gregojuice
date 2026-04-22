/**
 * Admin schnorr account handling for deploy scripts. Reproducible addresses
 * via `SALT` env var, on-demand secret generation, and "deploy if missing"
 * registration against a running PXE.
 */
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";

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
 * Registers the admin schnorr account in the wallet (PXE) and verifies it is
 * already initialised on-chain. Throws with `hint` appended to the error if
 * not — the caller typically names the script that should have run first
 * (e.g. `Run \`yarn swap deploy-admin:<network>\` first.`).
 *
 * Does **not** deploy the account — that's the deploy-admin scripts' job.
 * Every other script should use this.
 */
export async function getAdmin(
  wallet: EmbeddedWallet,
  secretKey: Fr,
  hint: string,
): Promise<AztecAddress> {
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, getSalt(), signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);
  if (initializationStatus !== ContractInitializationStatus.INITIALIZED) {
    throw new Error(
      `Admin account ${accountManager.address.toString()} is not initialised on-chain. ${hint}`,
    );
  }
  return accountManager.address;
}
