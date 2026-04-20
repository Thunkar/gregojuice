import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readState,
  writeState,
  STATE_FILES,
  type GlobalState,
  type FpcState,
  type SwapState,
} from "../../fixtures/state.ts";

/**
 * Spec 04 — fpc-admin signs up two sponsored apps.
 *
 * Flow:
 *   1. Mint GregoCoin + GregoCoinPremium to fpc-admin (so calibration can
 *      simulate swap / mint calls). Uses swap-admin as the signer via
 *      `apps/swap/scripts/mint.ts` in a subprocess.
 *   2. Restore the spec-01 backup into a fresh fpc-dashboard context so we
 *      have the same fpc-admin + FPC contract.
 *   3. In the "Sign Up App" tab, run the full 4-step wizard twice:
 *      - ProofOfPassword::check_password_and_mint — mints GregoCoin
 *        for a user that presents the password.
 *      - AMM::swap_tokens_for_exact_tokens_from — swaps GregoCoin for
 *        GregoCoinPremium on behalf of a user.
 *   4. Compute function selectors from the artifacts (same logic as
 *      `apps/swap/scripts/add-subscription-fpc.ts`) and write the
 *      `subscriptionFPC` section into swap's `local.json`, plus update
 *      `e2e/.state/fpc.json` with the signed-up apps.
 *
 * Both the fpc-admin (funded by spec 01 bridge) and the fpc contract
 * (funded by spec 01 Deploy FPC step) still hold fee juice from earlier,
 * so this spec does not touch the bridge.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SWAP_DIR = resolve(REPO_ROOT, "apps/swap");
const SWAP_LOCAL_JSON = resolve(SWAP_DIR, "src/config/networks/local.json");
const ARTIFACTS_DIR = resolve(REPO_ROOT, "packages/contracts/aztec/noir/target");
const POP_ARTIFACT_PATH = resolve(ARTIFACTS_DIR, "proof_of_password-ProofOfPassword.json");
const AMM_ARTIFACT_PATH = resolve(ARTIFACTS_DIR, "amm_contract-AMM.json");

const PASSWORD = process.env.PASSWORD ?? "gregoE2E!";

function runMint(env: NodeJS.ProcessEnv, toAddress: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(
      "node",
      [
        "--experimental-transform-types",
        "scripts/mint.ts",
        "--network",
        "local",
        "--to",
        toAddress,
      ],
      { cwd: SWAP_DIR, env, stdio: "inherit" },
    );
    child.on("exit", (code) => {
      if (code === 0) res();
      else rej(new Error(`mint.ts exited with code ${code}`));
    });
    child.on("error", rej);
  });
}

async function restoreBackup(page: Page, backupPath: string) {
  // Seed network selection before the app boots so the SetupWizard doesn't
  // bounce us to testnet.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("gregojuice_network", "local");
    } catch {
      /* ignore */
    }
  });

  await page.goto("/");

  // The SetupWizard is always the landing view until fpc-admin is restored.
  // It exposes the "Restore from Backup" affordance in import-only mode.
  await page.getByTestId("setup-wizard").waitFor({ timeout: 60_000 });

  // The import-only button triggers the hidden input via a ref click,
  // which would pop the OS file dialog — Playwright can't drive that.
  // Instead we wait for the input to attach and set files directly.
  await page.getByTestId("backup-import-trigger").waitFor({ timeout: 30_000 });
  await page.getByTestId("backup-import-input").setInputFiles(backupPath);

  // Confirmation dialog appears — click "Restore". The confirm button is
  // inside the dialog's Paper, so waiting for the button to attach implies
  // the dialog rendered.
  const confirmBtn = page.getByTestId("backup-import-confirm-button");
  await confirmBtn.waitFor({ state: "visible", timeout: 30_000 });
  await confirmBtn.click();

  // applyBackup() triggers window.location.reload(). Wait for the dashboard
  // to render post-reload — that's the signal that fpc-admin was restored.
  await page.getByTestId("dashboard").waitFor({ timeout: 120_000 });
}

interface SignUpArgs {
  artifactPath: string;
  contractAddress: string;
  contractAlias: string;
  functionName: string;
  /** function args in declaration order, already stringified as the form expects */
  args: Record<string, string>;
  /** Extra contract registrations required by the sponsored function. */
  extras: { artifactPath: string; address: string; alias: string }[];
  configIndex: number;
}

async function signUpOneApp(page: Page, args: SignUpArgs) {
  const wizard = page.getByTestId("app-signup");

  // Ensure we're at step 0 (artifact + address). Previous sign-up resets
  // to step 0 after 3s; if we're still on step 3, wait for the reset.
  await expect(wizard).toHaveAttribute("data-active-step", "0", { timeout: 30_000 });

  // ── Step 0: upload artifact, enter address, register ────────────────
  await page.getByTestId("app-signup-artifact").setInputFiles(args.artifactPath);
  await page.getByTestId("app-signup-contract-alias").fill(args.contractAlias);
  await page.getByTestId("app-signup-contract-address").fill(args.contractAddress);
  await page.getByTestId("app-signup-register").click();

  // Race: success alert or error alert.
  const registerSuccess = page.getByTestId("app-signup-register-success");
  const registerError = page.getByTestId("app-signup-register-error");
  await Promise.race([
    registerSuccess.waitFor({ state: "visible", timeout: 60_000 }),
    registerError.waitFor({ state: "visible", timeout: 60_000 }).then(async () => {
      throw new Error(`register failed: ${await registerError.textContent()}`);
    }),
  ]);

  // The register handler auto-advances to step 1.
  await expect(wizard).toHaveAttribute("data-active-step", "1", { timeout: 10_000 });

  // ── Step 1: pick the function ──────────────────────────────────────
  await page.getByTestId("app-signup-function-select-display").click();
  await page.getByTestId(`app-signup-function-select-option-${args.functionName}`).click();

  // FunctionSelector's handler auto-advances to step 2.
  await expect(wizard).toHaveAttribute("data-active-step", "2", { timeout: 10_000 });

  // ── Step 2: register extras, fill args, calibrate ──────────────────
  for (const extra of args.extras) {
    await page.getByTestId("app-signup-extra-artifact").setInputFiles(extra.artifactPath);
    await page.getByTestId("app-signup-extra-address").fill(extra.address);
    await page.getByTestId("app-signup-extra-alias").fill(extra.alias);
    await page.getByTestId("app-signup-extra-register").click();
    // The extra-register handler clears the form and adds a chip. Wait
    // for the chip keyed by alias to confirm the registration landed.
    await expect(page.getByTestId(`app-signup-extra-chip-${extra.alias}`)).toBeVisible({
      timeout: 60_000,
    });
  }

  // Fill each arg input by parameter name.
  for (const [paramName, value] of Object.entries(args.args)) {
    await page.getByTestId(`app-signup-arg-${paramName}`).fill(value);
  }

  // Click calibrate. The "Run Calibration" button is always enabled, so
  // we can click directly. Wait for either the calibration container to
  // report calibrated=true or for the error alert.
  const calibration = page.getByTestId("app-signup-calibration");
  const calibrationError = page.getByTestId("app-signup-calibration-error");
  await page.getByTestId("app-signup-calibrate").click();

  await Promise.race([
    expect(calibration)
      .toHaveAttribute("data-calibrated", "true", { timeout: 240_000 })
      .then(() => {}),
    calibrationError.waitFor({ state: "visible", timeout: 240_000 }).then(async () => {
      throw new Error(`calibration failed: ${await calibrationError.textContent()}`);
    }),
  ]);

  // Continue to review — this button only renders once calibrated.
  await page.getByTestId("app-signup-calibration-continue").click();
  await expect(wizard).toHaveAttribute("data-active-step", "3", { timeout: 10_000 });

  // ── Step 3: max-fee is auto-filled, set configIndex, sign up ────────
  await page.getByTestId("app-signup-config-index").fill(String(args.configIndex));
  // Max fee is pre-populated from the P75 pricing; we just verify it's
  // non-empty to avoid submitting with an empty fee.
  await expect(page.getByTestId("app-signup-max-fee")).not.toHaveValue("", {
    timeout: 60_000,
  });

  const submitError = page.getByTestId("app-signup-submit-error");
  await page.getByTestId("app-signup-submit").click();

  const success = page.getByTestId("app-signup-success");
  await Promise.race([
    success.waitFor({ state: "visible", timeout: 300_000 }),
    submitError.waitFor({ state: "visible", timeout: 300_000 }).then(async () => {
      throw new Error(`sign-up failed: ${await submitError.textContent()}`);
    }),
  ]);
}

test.describe.serial("fpc signs up sponsored apps", () => {
  test.slow();

  // Mint BEFORE the browser starts. If we ran this inside the test body
  // the `page` fixture would instantiate first, popping an empty browser
  // window while the mint subprocess churns. `beforeAll` doesn't take the
  // page fixture so nothing is launched yet.
  test.beforeAll(async () => {
    const global = await readState<GlobalState>(STATE_FILES.global);
    const fpc = await readState<FpcState>(STATE_FILES.fpc);
    console.log(`[e2e] minting GregoCoin + GregoCoinPremium to ${fpc.fpcAdminAddress}`);
    await runMint(
      {
        ...process.env,
        SECRET: global.swapAdmin.secret,
      },
      fpc.fpcAdminAddress,
    );
  });

  test("signs up PoP + AMM via the fpc-dashboard UI", async ({ page }) => {
    const fpc = await readState<FpcState>(STATE_FILES.fpc);
    const swap = await readState<SwapState>(STATE_FILES.swap);

    // ── 1. Restore fpc-admin backup into a fresh dashboard context ───
    await restoreBackup(page, fpc.backupPath);

    // Switch to the Sign Up App tab (it's the default but be explicit).
    await page.getByTestId("tab-sign-up").click();
    await page.getByTestId("app-signup").waitFor({ timeout: 10_000 });

    // ── 2a. Sign up ProofOfPassword::check_password_and_mint ─────────
    console.log("[e2e] signing up PoP::check_password_and_mint");
    await signUpOneApp(page, {
      artifactPath: POP_ARTIFACT_PATH,
      contractAddress: swap.pop,
      contractAlias: "ProofOfPassword",
      functionName: "check_password_and_mint",
      args: {
        password: PASSWORD,
        to: fpc.fpcAdminAddress,
      },
      extras: [
        {
          artifactPath: resolve(ARTIFACTS_DIR, "token_contract-Token.json"),
          address: swap.gregoCoin,
          alias: "GregoCoin",
        },
      ],
      configIndex: 0,
    });

    // ── 2b. Sign up AMM::swap_tokens_for_exact_tokens_from ───────────
    console.log("[e2e] signing up AMM::swap_tokens_for_exact_tokens_from");
    await signUpOneApp(page, {
      artifactPath: AMM_ARTIFACT_PATH,
      contractAddress: swap.amm,
      contractAlias: "AMM",
      functionName: "swap_tokens_for_exact_tokens_from",
      args: {
        from: fpc.fpcAdminAddress,
        token_in: swap.gregoCoin,
        token_out: swap.gregoCoinPremium,
        amount_out: "100",
        amount_in_max: "1000000",
        authwit_nonce: "0",
      },
      extras: [
        {
          artifactPath: resolve(ARTIFACTS_DIR, "token_contract-Token.json"),
          address: swap.gregoCoinPremium,
          alias: "GregoCoinPremium",
        },
      ],
      configIndex: 0,
    });

    // ── 3. Sanity: the list tab shows 2 apps ─────────────────────────
    await page.getByTestId("tab-registered-apps").click();
    await expect(page.getByTestId("app-list")).toHaveAttribute("data-count", "2", {
      timeout: 30_000,
    });

    // ── 4. Compute selectors and patch swap local.json ───────────────
    // We reuse the same logic as apps/swap/scripts/add-subscription-fpc.ts.
    const { FunctionSelector } = await import("@aztec/stdlib/abi");
    const popArtifactJson = JSON.parse(await readFile(POP_ARTIFACT_PATH, "utf-8"));
    const ammArtifactJson = JSON.parse(await readFile(AMM_ARTIFACT_PATH, "utf-8"));
    const popFn = popArtifactJson.functions.find(
      (f: { name: string }) => f.name === "check_password_and_mint",
    );
    const ammFn = ammArtifactJson.functions.find(
      (f: { name: string }) => f.name === "swap_tokens_for_exact_tokens_from",
    );
    if (!popFn || !ammFn) throw new Error("Expected functions missing from artifact JSON");
    const popSelector = await FunctionSelector.fromNameAndParameters(popFn.name, popFn.parameters);
    const ammSelector = await FunctionSelector.fromNameAndParameters(ammFn.name, ammFn.parameters);

    const swapConfig = JSON.parse(await readFile(SWAP_LOCAL_JSON, "utf-8"));
    swapConfig.subscriptionFPC = {
      address: fpc.fpcAddress,
      secretKey: fpc.fpcSecretKey,
      functions: {
        [swap.pop]: {
          [popSelector.toString()]: 0,
        },
        [swap.amm]: {
          [ammSelector.toString()]: 0,
        },
      },
    };
    await writeFile(SWAP_LOCAL_JSON, JSON.stringify(swapConfig, null, 2), "utf-8");
    console.log(`[e2e] patched ${SWAP_LOCAL_JSON} with subscriptionFPC`);

    // ── 5. Persist spec-04 output into fpc.json ──────────────────────
    const updatedFpc: FpcState = {
      ...fpc,
      signedUp: {
        "pop:check_password_and_mint": {
          contractAddress: swap.pop,
          functionName: "check_password_and_mint",
          selector: popSelector.toString(),
          configIndex: 0,
        },
        "amm:swap_tokens_for_exact_tokens_from": {
          contractAddress: swap.amm,
          functionName: "swap_tokens_for_exact_tokens_from",
          selector: ammSelector.toString(),
          configIndex: 0,
        },
      },
    };
    await writeState(STATE_FILES.fpc, updatedFpc);
  });
});
