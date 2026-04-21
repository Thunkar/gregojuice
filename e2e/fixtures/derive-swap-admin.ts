/**
 * Deterministically derives the swap-admin's Fr secret + L2 address.
 *
 * Must match the logic in `apps/swap/scripts/utils.ts::getOrCreateDeployer`:
 *   - salt = Fr(0)
 *   - secret = Fr.fromString(<fixed seed>)
 *   - schnorr signing key derived via `deriveSigningKey(secret)`
 *
 * Using a fixed seed keeps the swap-admin address stable across test runs
 * so logs, state files, and any on-disk snapshots are comparable.
 */
import { Fr } from "@aztec/foundation/curves/bn254";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getPXEConfig } from "@aztec/pxe/server";

const SWAP_ADMIN_SEED = "0x" + "5757".padEnd(62, "0"); // "SW...AP" — cosmetic
const SALT = new Fr(0);

export interface SwapAdmin {
  secret: string;
  address: string;
}

export async function deriveSwapAdmin(nodeUrl: string): Promise<SwapAdmin> {
  const secret = Fr.fromString(SWAP_ADMIN_SEED);
  const signingKey = deriveSigningKey(secret);

  // Spin up an ephemeral wallet just to compute the deterministic address.
  // This is cheap (no tx submitted) and matches what getOrCreateDeployer
  // does when it later reconstructs the same account.
  const node = createAztecNodeClient(nodeUrl);
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled: false },
  });
  const accountManager = await wallet.createSchnorrAccount(secret, SALT, signingKey);

  return { secret: secret.toString(), address: accountManager.address.toString() };
}
