/**
 * Deploys the swap admin schnorr account, generating a fresh secret if the
 * caller didn't supply one.
 *
 * - On `local`: deploys via SponsoredFPC — no bridge, no funding needed.
 *   The admin doesn't pay for anything in the local dev flow (sponsored).
 * - On `testnet`: bridges fee juice to the admin's deterministic address
 *   and deploys using the freshly-claimed FJ as the payment method
 *   (claim + deploy in one tx).
 *
 * Usage:
 *   yarn swap deploy-admin --network <local|testnet>
 *
 * Env vars:
 *   SWAP_ADMIN_SECRET — hex Fr for the admin secret. If unset, a new key is
 *                       generated and the script prints an `export SWAP_ADMIN_SECRET=…`
 *                       line on stdout before exiting.
 *   L1_FUNDER_KEY     — testnet only. L1 private key holding FJ. When unset,
 *                       a random L1 key is generated and the faucet mints FJ.
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
  getSalt,
} from "@gregojuice/common/testing";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { NO_FROM } from "@aztec/aztec.js/account";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";
import { deriveSigningKey } from "@aztec/stdlib/keys";

const FUND_AMOUNT: bigint = BigInt("1000000000000000000000"); // 1000 FJ

async function main() {
  const network = parseNetwork();
  const { secretKey, generated } = loadOrCreateSecret("SWAP_ADMIN_SECRET");

  const adminAddress = await deriveSchnorrAdminAddress(secretKey);
  console.error(`Swap admin address: ${adminAddress.toString()}`);

  const { node, wallet, paymentMethod: sponsoredPaymentMethod } = await setupWallet(
    NETWORK_URLS[network],
    network,
    network === "local" ? "sponsoredfpc" : "feejuice",
  );
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, getSalt(), signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);
  if (initializationStatus === ContractInitializationStatus.INITIALIZED) {
    console.error("Admin account already initialised on-chain, skipping deploy.");
  } else if (network === "local") {
    // SponsoredFPC pays — no bridge needed. Faster than bridging FJ just to
    // fund an admin that never pays for anything in practice.
    console.error("Deploying admin account via SponsoredFPC...");
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: 120 },
    });
    console.error("Admin account deployed.");
  } else {
    // Testnet: SponsoredFPC doesn't exist. Bridge FJ and pay for the deploy
    // with the freshly-claimed FJ via FeeJuicePaymentMethodWithClaim (claim
    // + deploy in one private tx).
    console.error(`Bridging FJ to ${adminAddress.toString()}...`);
    const { claim, l1Address, minted } = await bridge({
      node,
      recipient: adminAddress,
      l1RpcUrl: L1_DEFAULTS[network].l1RpcUrl,
      l1ChainId: L1_DEFAULTS[network].l1ChainId,
      amount: FUND_AMOUNT,
      l1PrivateKey: resolveL1Funder(network),
      mode: bridgeMode(network),
    });
    console.error(
      `Bridged ${claim.claimAmount} FJ from L1 address ${l1Address} (minted=${minted}).`,
    );

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
    console.log(`export SWAP_ADMIN_SECRET=${secretKey.toString()}`);
  }
  console.log(`export SWAP_ADMIN_ADDRESS=${adminAddress.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
