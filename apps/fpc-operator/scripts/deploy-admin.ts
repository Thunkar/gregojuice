/**
 * Mirrors apps/swap/scripts/deploy-admin.ts but for the FPC admin.
 * On local: deploys via SponsoredFPC (no bridge). On testnet: bridges FJ and
 * deploys using the bridged claim as payment method (claim + deploy in one tx).
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
  const { secretKey, generated } = loadOrCreateSecret("FPC_ADMIN_SECRET");

  const adminAddress = await deriveSchnorrAdminAddress(secretKey);
  console.error(`FPC admin address: ${adminAddress.toString()}`);

  const {
    node,
    wallet,
    paymentMethod: sponsoredPaymentMethod,
  } = await setupWallet(
    NETWORK_URLS[network],
    network,
    network === "local" ? "sponsoredfpc" : "feejuice",
  );
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, getSalt(), signingKey);

  const { initializationStatus } = await wallet.getContractMetadata(accountManager.address);
  if (initializationStatus === ContractInitializationStatus.INITIALIZED) {
    console.error("FPC admin account already initialised on-chain, skipping deploy.");
  } else if (network === "local") {
    // SponsoredFPC pays — no bridge needed.
    console.error("Deploying FPC admin account via SponsoredFPC...");
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: 120 },
    });
    console.error("FPC admin account deployed.");
  } else {
    // Testnet: SponsoredFPC doesn't exist — bridge FJ and use it to fund the deploy.
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
    console.error("FPC admin account deployed.");
  }

  if (generated) {
    console.log(`export FPC_ADMIN_SECRET=${secretKey.toString()}`);
  }
  console.log(`export FPC_ADMIN_ADDRESS=${adminAddress.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
