import { test, expect } from "@playwright/test";
import {
  writeState,
  readState,
  STATE_FILES,
  type GlobalState,
  type FpcState,
} from "../../fixtures/state.ts";
import { injectL1Wallet, ANVIL_DEV_KEY } from "../../fixtures/inject-l1-wallet.ts";
import { pumpL2Blocks } from "../../fixtures/pump-l2-blocks.ts";

/**
 * Spec 01 — fpc-dashboard setup.
 *
 * Drives the real fpc-dashboard UI through its SetupWizard:
 *   1. wait for step 1 "Fund Admin & FPC" to activate
 *   2. let the bridge iframe mint+bridge via faucet, advance L1→L2, claim
 *   3. click "Deploy FPC"
 *   4. land on the Dashboard (export-backup button visible)
 *
 * Still TODO in follow-up iterations:
 *   - click "Export Backup" + capture the JSON download
 *   - persist fpc-admin secret + fpc address to fpc.json
 */
test.describe.serial("fpc-dashboard setup", () => {
  test.slow();

  test("deploys a SubscriptionFPC via the real UI", async ({ page }) => {
    const global = await readState<GlobalState>(STATE_FILES.global);

    await injectL1Wallet(page, {
      privateKey: ANVIL_DEV_KEY,
      rpcUrl: global.l1RpcUrl,
      chainId: global.chainId,
    });

    // Pre-seed the network selection so fpc-dashboard targets `local`
    // instead of the default `testnet`. The bridge iframe inherits the
    // network id via the `?network=local` query param the dashboard injects.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("gregojuice_network", "local");
      } catch {
        /* ignore */
      }
    });

    await page.goto("/");

    // ── Step 1: bridge ────────────────────────────────────────────────
    await expect(
      page.getByText(/Bridge fee juice to fund both your admin account and the FPC contract/i),
    ).toBeVisible({ timeout: 90_000 });

    const bridge = page.frameLocator('iframe[src*="localhost:5173"]');
    const bridgeButton = bridge.getByTestId("bridge-submit");
    await expect(bridgeButton).toBeEnabled({ timeout: 60_000 });
    await bridgeButton.click();

    // Pump L2 blocks only while the iframe is waiting for the L1→L2
    // message — local-network is otherwise idle.
    await expect(bridge.getByText(/L1 deposit confirmed/i)).toBeVisible({ timeout: 60_000 });
    const stopPump = await pumpL2Blocks({
      nodeUrl: global.nodeUrl,
      l1RpcUrl: global.l1RpcUrl,
    });
    try {
      await expect(bridge.getByText(/^Claimed$/)).toBeVisible({ timeout: 180_000 });
    } finally {
      await stopPump();
    }

    // ── Step 2: deploy FPC ────────────────────────────────────────────
    await expect(page.getByText(/Deploy the SubscriptionFPC contract on-chain/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /^Deploy FPC$/ }).click();

    // After deploy, the Dashboard replaces the wizard. The Dashboard exposes
    // BackupRestore in full mode with a prominent "Export Backup" button.
    await expect(page.getByRole("button", { name: /^Export Backup$/ })).toBeVisible({
      timeout: 180_000,
    });
  });

  test.skip("exports the backup JSON + persists fpc.json", async () => {
    // TODO: click Export Backup, capture the download, write e2e/.state/fpc.json
    const fpc: FpcState = { fpcAddress: "0x...", fpcAdminAddress: "0x...", backup: {} };
    await writeState(STATE_FILES.fpc, fpc);
  });
});
