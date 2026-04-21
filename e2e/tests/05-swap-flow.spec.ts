import { test, expect, type Page } from "@playwright/test";
import {
  readState,
  STATE_FILES,
  type GlobalState,
  type SwapDeploymentState,
} from "../fixtures/state.ts";

/**
 * Spec 05 — end-user swap flow.
 *
 * Drives the swap app through its happy path:
 *   1. Pick the embedded wallet in the onboarding modal (skips the whole
 *      external-wallet discovery + emoji verification dance).
 *   2. Balance is 0 → drip password form appears. Submit the password
 *      that spec 03 baked into the PoP contract → fpc-admin sponsors the
 *      mint via PoP::check_password_and_mint → modal closes with a fresh
 *      GregoCoin balance.
 *   3. Balance > 0 → swap UI enables. Enter a small FROM amount, click
 *      Swap → fpc-admin sponsors the AMM swap_tokens_for_exact_tokens_from
 *      tx → wait for phase=success.
 *   4. Verify balances moved: GregoCoin went down, GregoCoinPremium went up.
 *
 * Assumes specs 01-04 ran (fpc.json + swap.json + local.json all present
 * with the subscriptionFPC section wired up).
 */

const FROM_AMOUNT = "10";

async function openOnboarding(page: Page) {
  // Seed the active network BEFORE any script runs so the app picks local
  // rather than its default (testnet). NetworkSwitcher reads this key.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("gregoswap_network", "local");
    } catch {
      /* ignore */
    }
  });

  await page.goto("/");

  const walletChip = page.getByTestId("wallet-chip");
  await walletChip.waitFor({ timeout: 60_000 });
  // Click to trigger onboarding (chip shows "Connect wallet" when not connected).
  await expect(walletChip).toHaveAttribute("data-connected", "false", { timeout: 30_000 });
  await walletChip.click();
}

test.describe.serial("gregoswap end-user flow", () => {
  test.slow();

  test("onboards with embedded wallet, drips, and swaps", async ({ page }) => {
    const global = await readState<GlobalState>(STATE_FILES.global);
    const swap = await readState<SwapDeploymentState>(STATE_FILES.swapDeployment);
    console.log(`[e2e] target node=${global.nodeUrl}, gregoCoin=${swap.gregoCoin}`);

    // Forward browser console + pageerror to test output — essential for
    // diagnosing hangs inside the swap UI (drip tx failures, simulation
    // errors, etc.) that never surface as test assertions.
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning" || t === "info") {
        console.log(`[browser:${t}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      console.log(`[browser:pageerror] ${err.message}`);
    });

    await openOnboarding(page);

    // ── 1. Pick embedded wallet ──────────────────────────────────────
    const modal = page.getByTestId("onboarding-modal");
    await modal.waitFor({ timeout: 30_000 });
    await page.getByTestId("onboarding-use-embedded").click();

    // ── 2. Drip: balance is 0, password form appears ────────────────
    await expect(modal).toHaveAttribute("data-status", "awaiting_drip", { timeout: 120_000 });

    const dripInput = page.getByTestId("drip-password-input");
    await dripInput.waitFor({ timeout: 10_000 });
    await dripInput.fill(swap.password);
    await page.getByTestId("drip-password-submit").click();

    // On success the reducer dispatches DRIP_SUCCESS then COMPLETE, and
    // the modal auto-closes which in turn fires CLOSE_MODAL — the latter
    // resets `dripPhase` back to `idle`. All of this can land in a single
    // React commit, so `data-drip-phase="success"` is too narrow a window
    // to reliably assert on. The modal hiding is the only stable terminal
    // signal for a successful drip.
    await modal.waitFor({ state: "hidden", timeout: 300_000 });

    // ── 3. Swap flow: balance is non-zero, swap a small amount ──────
    const swapContainer = page.getByTestId("swap-container");
    await swapContainer.waitFor({ timeout: 30_000 });

    // Wait for balances to hydrate. The FROM box's data-balance flips
    // from "" (loading / no balance) to a numeric string when the
    // balance query resolves.
    const fromBox = page.getByTestId("swap-from");
    await expect(async () => {
      const raw = await fromBox.getAttribute("data-balance");
      expect(raw).not.toBe("");
      expect(raw).not.toBeNull();
      expect(BigInt(raw as string)).toBeGreaterThan(0n);
    }).toPass({ timeout: 60_000 });

    const fromBalanceBefore = BigInt((await fromBox.getAttribute("data-balance")) ?? "0");
    const toBalanceBefore = BigInt(
      (await page.getByTestId("swap-to").getAttribute("data-balance")) ?? "0",
    );
    console.log(`[e2e] pre-swap balances: GRG=${fromBalanceBefore} GRGP=${toBalanceBefore}`);

    await page.getByTestId("swap-from-input").fill(FROM_AMOUNT);

    // Submit button becomes enabled once the exchange rate resolves and
    // the amount is valid.
    const submit = page.getByTestId("swap-submit");
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await submit.click();

    // Wait for the swap to succeed. SwapContainer exposes the current
    // phase via `data-phase`.
    await expect(swapContainer).toHaveAttribute("data-phase", "success", { timeout: 300_000 });

    // ── 4. Verify balances moved in the expected direction ──────────
    // Balances refetch after phase=success; poll until they reflect the
    // trade.
    await expect(async () => {
      const fromAfter = BigInt((await fromBox.getAttribute("data-balance")) ?? "-1");
      const toAfter = BigInt(
        (await page.getByTestId("swap-to").getAttribute("data-balance")) ?? "-1",
      );
      expect(fromAfter).toBeLessThan(fromBalanceBefore);
      expect(toAfter).toBeGreaterThan(toBalanceBefore);
    }).toPass({ timeout: 60_000 });
  });
});
