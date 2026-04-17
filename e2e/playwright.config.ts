import { defineConfig, devices } from "@playwright/test";

/**
 * Each project runs one app's dev server on a unique port and points tests
 * at it. The shared sandbox + deploy lifecycle runs in globalSetup/Teardown.
 *
 * Scaffolding only — test flows (onboarding, swap, bridge, fpc-operator)
 * will be added once the harness is proven against a live sandbox.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  globalSetup: "./fixtures/global-setup.ts",
  globalTeardown: "./fixtures/global-teardown.ts",
  use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "swap",
      testMatch: /.*swap.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5175",
      },
    },
    {
      name: "bridge",
      testMatch: /.*bridge.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5173",
      },
    },
    {
      name: "fpc-operator",
      testMatch: /.*fpc-operator.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5174",
      },
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
