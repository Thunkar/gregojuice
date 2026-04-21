/**
 * Generates (or loads) the swap admin account secret, bridges fee juice to
 * its deterministic address, and deploys the schnorr account using the
 * bridged claim as the payment method (claim + deploy in one tx).
 *
 * Usage:
 *   yarn swap fund-admin --network <local|testnet>
 *
 * Env vars:
 *   SWAP_SECRET   — hex Fr for the admin secret. If unset, a new key is
 *                   generated and the script prints an `export SWAP_SECRET=…`
 *                   line on stdout before exiting.
 *   L1_FUNDER_KEY — optional. L1 private key holding FJ on the target chain.
 *                   Defaults to anvil dev key on `local` (with mint=true via
 *                   the faucet handler). On `testnet`, when unset, a random
 *                   L1 key is generated and the faucet mints FJ for us.
 */
import { bridge } from "@gregojuice/common/bridging";
import {
  parseNetwork,
  NETWORK_URLS,
  L1_DEFAULTS,
  resolveL1Funder,
  bridgeMode,
  setupWallet,
  loadOrCreateSecret,
  deriveSchnorrAdminAddress,
} from "@gregojuice/common/testing";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { NO_FROM } from "@aztec/aztec.js/account";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { Fr } from "@aztec/foundation/curves/bn254";

const FUND_AMOUNT: bigint = BigInt("1000000000000000000000"); // 1000 FJ

async function main() {
  const network = parseNetwork();
  const { secretKey, generated } = loadOrCreateSecret("SWAP_SECRET");

  const adminAddress = await deriveSchnorrAdminAddress(secretKey);
  console.error(`Swap admin address: ${adminAddress.toString()}`);

  const { node, wallet } = await setupWallet(NETWORK_URLS[network], network);
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, new Fr(0), signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);
  if (initializationStatus === ContractInitializationStatus.INITIALIZED) {
    console.error("Admin account already initialised on-chain, skipping bridge + deploy.");
  } else {
    const { l1FunderKey, mint } = resolveL1Funder(network);
    console.error(`Bridging ${mint ? "faucet" : FUND_AMOUNT} FJ to ${adminAddress.toString()}...`);
    const { claim, l1Address } = await bridge({
      node,
      recipient: adminAddress,
      l1RpcUrl: L1_DEFAULTS[network].l1RpcUrl,
      l1ChainId: L1_DEFAULTS[network].l1ChainId,
      amount: mint ? undefined : FUND_AMOUNT,
      mint,
      l1PrivateKey: l1FunderKey,
      mode: bridgeMode(network),
    });
    console.error(`Bridged ${claim.claimAmount} FJ from L1 address ${l1Address}.`);

    // Claim + deploy in one private tx: FeeJuicePaymentMethodWithClaim prepends
    // a `claim_and_end_setup` call before the account-deploy execution. The
    // fresh account pays for its own deploy from the freshly-claimed FJ.
    const paymentMethod = new FeeJuicePaymentMethodWithClaim(adminAddress, claim);
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
      from: NO_FROM,
      fee: { paymentMethod },
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: 120 },
    });
    console.error("Admin account deployed.");
  }

  if (generated) {
    console.log(`export SWAP_SECRET=${secretKey.toString()}`);
  }
  console.log(`export SWAP_ADMIN_ADDRESS=${adminAddress.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
