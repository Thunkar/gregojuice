/**
 * Deploys a new SubscriptionFPC and funds it on L2 via the bridge.
 *
 * Expects:
 *   --network <local|testnet>
 *   FPC_SECRET      — FPC admin secret (from `fund-fpc-admin`)
 *   FPC_KEY_SECRET  — optional. FPC contract key secret. Random if unset; printed back.
 *
 * Stdout (structured so callers can `eval $(... | grep ^export)`):
 *   export FPC_ADDRESS=0x…
 *   export FPC_KEY_SECRET=0x…
 *   export FPC_SALT=0x…
 *
 * Side output:
 *   apps/fpc-operator/backups/<network>.fpc-admin.json — contains the admin
 *   secret key, salt, FPC secret key, salt, and address. Git-ignored.
 */
import fs from "fs";
import path from "path";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
import { bridgeAndClaim } from "@gregojuice/common/bridging";
import { SubscriptionFPC } from "@gregojuice/aztec/subscription-fpc";
import { SubscriptionFPCContractArtifact } from "@gregojuice/aztec/artifacts/SubscriptionFPC";
import {
  parseNetwork,
  NETWORK_URLS,
  L1_DEFAULTS,
  resolveL1Funder,
  bridgeMode,
  setupWallet,
  loadOrCreateSecret,
  getOrCreateAdmin,
} from "@gregojuice/common/testing";

const FUND_AMOUNT: bigint = BigInt("1000000000000000000000"); // 1000 FJ

async function main() {
  const network = parseNetwork();
  const adminSecret = loadOrCreateSecret("FPC_SECRET");
  if (adminSecret.generated) {
    console.error(
      "FPC_SECRET not set — refusing to generate one here. Run `fund-fpc-admin` first.",
    );
    process.exit(1);
  }

  // FPC contract key secret (the "not actually secret" FPC key used so the FPC
  // can own private notes for its slot tracking). Deterministic if caller provides.
  const fpcKeySecret = loadOrCreateSecret("FPC_KEY_SECRET");
  const fpcSalt = Fr.random();

  const { node, wallet, paymentMethod } = await setupWallet(NETWORK_URLS[network], network);
  const admin = await getOrCreateAdmin(wallet, adminSecret.secretKey, paymentMethod);
  console.error(`FPC admin: ${admin.toString()}`);

  // Deploy the FPC with deterministic keys so the caller can register it later.
  console.error("Deploying SubscriptionFPC...");
  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(wallet, admin, {
    secretKey: fpcKeySecret.secretKey,
  });
  const instance = await deployment.getInstance({ contractAddressSalt: fpcSalt });
  await wallet.registerContract(instance, SubscriptionFPCContractArtifact, secretKey);
  const { receipt } = await deployment.send({
    from: admin,
    fee: { paymentMethod },
    contractAddressSalt: fpcSalt,
    wait: { returnReceipt: true },
  });
  const fpcAddress: AztecAddress = receipt.contract.address;
  console.error(`FPC deployed at ${fpcAddress.toString()}`);

  // Bridge FJ to the FPC itself so it can pay for sponsored calls.
  const { l1FunderKey, mint } = resolveL1Funder(network);
  console.error(`Bridging ${mint ? "faucet" : FUND_AMOUNT} FJ to FPC...`);
  const { amount } = await bridgeAndClaim({
    node,
    wallet,
    recipient: fpcAddress,
    claimFrom: admin,
    claimFeeOpts: { paymentMethod },
    l1RpcUrl: L1_DEFAULTS[network].l1RpcUrl,
    l1ChainId: L1_DEFAULTS[network].l1ChainId,
    amount: mint ? undefined : FUND_AMOUNT,
    mint,
    l1PrivateKey: l1FunderKey,
    mode: bridgeMode(network),
  });
  console.error(`Bridged ${amount} FJ to FPC.`);

  // Write the local backup file (gitignored).
  const backupDir = path.join(import.meta.dirname, "../backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${network}.fpc-admin.json`);
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    network,
    admin: {
      secretKey: adminSecret.secretKey.toString(),
      salt: new Fr(0).toString(),
      address: admin.toString(),
    },
    fpc: {
      address: fpcAddress.toString(),
      secretKey: fpcKeySecret.secretKey.toString(),
      salt: fpcSalt.toString(),
      deployed: true,
    },
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.error(`Wrote backup to ${backupPath}`);

  // Stdout contract: exportable env lines for the orchestrator.
  console.log(`export FPC_ADDRESS=${fpcAddress.toString()}`);
  console.log(`export FPC_KEY_SECRET=${fpcKeySecret.secretKey.toString()}`);
  console.log(`export FPC_SALT=${fpcSalt.toString()}`);
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
