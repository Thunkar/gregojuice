import { defineConfig, devices } from "@playwright/test";

/**
 * Project dependency graph (each edge is a `dependencies` link):
 *
 *   fpc-setup  →  bridge-fund  →  swap-deploy  →  fpc-signup  →  swap-flow
 *
 * - fpc-setup   (fpc-operator UI + bridge iframe) — creates fpc-admin + deploys FPC.
 * - bridge-fund (bridge UI) — funds swap-admin with fee juice.
 * - swap-deploy (node script) — runs swap-admin's deploy.ts with --payment feejuice.
 * - fpc-signup  (fpc-operator UI) — mints + registers contracts + 2× AppSignUp
 *                                   with calibration; writes swap's local.json.
 * - swap-flow   (swap UI) — end-user onboarding + sponsored swap + drip + send.
 *
 * The shared `aztec start --local-network`, L1 bridge deploy, and swap-admin
 * key derivation all happen in `globalSetup`.
 *
 * Environment toggles:
 *   E2E_HEADED=1       → headed browser (watch tests run)
 *   E2E_SLOW_MO=500    → slow down each action by N ms (implies headed)
 *   E2E_SKIP_NETWORK=1 → skip spawning `aztec start --local-network` in globalSetup;
 *                        assumes you already have one running
 */
const headed = process.env.E2E_HEADED === "1" || !!process.env.E2E_SLOW_MO;
const slowMo = process.env.E2E_SLOW_MO ? Number(process.env.E2E_SLOW_MO) : undefined;

const desktopChrome = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  globalSetup: "./fixtures/global-setup.ts",
  globalTeardown: "./fixtures/global-teardown.ts",
  use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
    headless: !headed,
    launchOptions: slowMo ? { slowMo } : undefined,
  },
  projects: [
    {
      name: "fpc-setup",
      testMatch: /setup\/01-fpc-setup\.spec\.ts$/,
      use: { ...desktopChrome, baseURL: "http://localhost:5174" },
    },
    {
      name: "bridge-fund",
      testMatch: /setup\/02-bridge-fund-swap-admin\.spec\.ts$/,
      dependencies: ["fpc-setup"],
      use: { ...desktopChrome, baseURL: "http://localhost:5173" },
    },
    {
      name: "swap-deploy",
      testMatch: /setup\/03-swap-deploy\.spec\.ts$/,
      dependencies: ["bridge-fund"],
      // No baseURL — runs deploy.ts via child_process. Chromium still launches
      // (Playwright quirk) but the spec never navigates.
      use: desktopChrome,
    },
    {
      name: "fpc-signup",
      testMatch: /setup\/04-fpc-signup\.spec\.ts$/,
      dependencies: ["swap-deploy"],
      use: { ...desktopChrome, baseURL: "http://localhost:5174" },
    },
    {
      name: "swap-flow",
      testMatch: /swap-flow\.spec\.ts$/,
      dependencies: ["fpc-signup"],
      use: { ...desktopChrome, baseURL: "http://localhost:5175" },
    },
    // ──────────────────────────────────────────────────────────────────
    // Standalone smoke project used during infra debugging. Not part of
    // the dependency graph — invoked explicitly with --project=setup-only.
    {
      name: "setup-only",
      testMatch: /setup-only\.spec\.ts$/,
      use: desktopChrome,
    },
  ],
  webServer: [
    {
      command: "yarn workspace @gregojuice/swap dev --port 5175 --strictPort",
      url: "http://localhost:5175",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "yarn workspace @gregojuice/bridge dev --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "yarn workspace @gregojuice/fpc-operator dev --port 5174 --strictPort",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
