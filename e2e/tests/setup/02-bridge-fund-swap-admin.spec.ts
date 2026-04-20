import { test, expect, type Frame } from "@playwright/test";
import {
  readState,
  writeState,
  hasState,
  STATE_FILES,
  type GlobalState,
} from "../../fixtures/state.ts";
import { injectL1Wallet, ANVIL_DEV_KEY } from "../../fixtures/inject-l1-wallet.ts";
import { pumpL2Blocks } from "../../fixtures/pump-l2-blocks.ts";
import { getPublicFeeJuiceBalance } from "../../fixtures/fee-juice-balance.ts";

/**
 * Spec 02 — fund the swap-admin via the bridge app.
 *
 * Drives the bridge app directly (no fpc-dashboard iframe). Walks the full
 * wizard manually: Step 3 recipient input, Step 4 "Mint & Bridge", claim.
 * Steps 1 + 2 auto-advance once the L1 wallet and Aztec embedded wallet
 * boot, so there's nothing manual to click there.
 *
 * After the claim lands, verifies programmatically via the Aztec node that
 * swap-admin holds a non-zero public fee-juice balance.
 */

const BRIDGE_SESSION_KEY = "gregojuice_bridge_session";

async function getBridgeSessionPhase(
  frame: Frame,
): Promise<"l1-pending" | "bridged" | "claiming" | null> {
  return frame.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { phase?: string };
      const p = parsed.phase;
      if (p === "l1-pending" || p === "bridged" || p === "claiming") return p;
      return null;
    } catch {
      return null;
    }
  }, BRIDGE_SESSION_KEY);
}

test.describe.serial("bridge funds swap-admin", () => {
  test.slow();

  test("bridges fee juice to swap-admin and confirms balance on L2", async ({ page }) => {
    test.skip(
      hasState(STATE_FILES.swapAdminFunded),
      `checkpoint exists at ${STATE_FILES.swapAdminFunded}`,
    );
    const global = await readState<GlobalState>(STATE_FILES.global);

    await injectL1Wallet(page, {
      privateKey: ANVIL_DEV_KEY,
      rpcUrl: global.l1RpcUrl,
      chainId: global.chainId,
    });

    // Seed the bridge app's network selection to `local` before any script
    // runs. Bridge app otherwise defaults to testnet.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("gregojuice_network", "local");
      } catch {
        /* ignore */
      }
    });

    await page.goto("/");

    // Step 1 (L1 wallet) auto-advances once the injected provider reports
    // an account + chainId. Step 2 (Aztec account) waits for the user to
    // choose between "I Have a Wallet" and "Use an Embedded Wallet"; we
    // pick the embedded path, which then auto-connects and advances the
    // wizard to step 3.
    const step2 = page.getByTestId("bridge-step-aztec");
    await expect(step2).toHaveAttribute("data-status", "active", { timeout: 90_000 });
    await page.getByTestId("aztec-choice-embedded").click();

    const step3 = page.getByTestId("bridge-step-recipient");
    await expect(step3).toHaveAttribute("data-status", "active", { timeout: 60_000 });

    // Step 3: paste swap-admin's L2 address and continue.
    await page.getByTestId("recipient-address-0").fill(global.swapAdmin.address);
    const continueBtn = page.getByTestId("recipient-continue");
    await expect(continueBtn).toBeVisible({ timeout: 10_000 });
    await continueBtn.click();

    // Step 4: faucet pre-fills the amount, button becomes enabled.
    const step4 = page.getByTestId("bridge-step-bridge");
    await expect(step4).toHaveAttribute("data-status", "active", { timeout: 30_000 });
    const bridgeSubmit = page.getByTestId("bridge-submit");
    await expect(bridgeSubmit).toBeEnabled({ timeout: 60_000 });
    await bridgeSubmit.click();

    // Pump L2 only while the session is in `bridged` or `claiming`.
    await expect(async () => {
      const phase = await getBridgeSessionPhase(page.mainFrame());
      expect(phase === "bridged" || phase === "claiming").toBe(true);
    }).toPass({ timeout: 60_000 });

    // Scope the pump to the L1→L2 message sync window only. The claim tx
    // that runs afterwards must not race pump-induced empty blocks.
    const postPhase = page.getByTestId("bridge-post-phase");
    const stopPump = await pumpL2Blocks({
      nodeUrl: global.nodeUrl,
      l1RpcUrl: global.l1RpcUrl,
    });
    try {
      await expect(postPhase).toHaveAttribute("data-l2-synced", "true", { timeout: 180_000 });
    } finally {
      await stopPump();
    }

    await expect(postPhase).toHaveAttribute("data-claimed", "true", { timeout: 180_000 });

    // Programmatic check: swap-admin should now have public FJ on L2.
    const balance = await getPublicFeeJuiceBalance(global.nodeUrl, global.swapAdmin.address);
    console.log(`[e2e] swap-admin FJ balance = ${balance}`);
    expect(balance).toBeGreaterThan(0n);

    // Drop a checkpoint marker so subsequent runs skip this spec.
    await writeState(STATE_FILES.swapAdminFunded, {
      address: global.swapAdmin.address,
      balance: balance.toString(),
      fundedAt: new Date().toISOString(),
    });
  });
});
