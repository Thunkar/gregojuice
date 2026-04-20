import { test, expect } from "@playwright/test";
import { readState, STATE_FILES, type GlobalState } from "../fixtures/state.ts";

/**
 * No-op spec used to drive `globalSetup` during development/debugging.
 * Asserts that global state was written, then exits.
 *
 * Usage:
 *   # Assuming `aztec start --local-network` is already running:
 *   E2E_SKIP_NETWORK=1 yarn workspace @gregojuice/e2e test tests/setup-only.spec.ts --project=swap
 */
test("globalSetup produced global.json", async () => {
  const state = await readState<GlobalState>(STATE_FILES.global);
  expect(state.l1BridgeAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(state.swapAdmin.address).toMatch(/^0x[0-9a-fA-F]+$/);
  expect(state.swapAdmin.secret).toMatch(/^0x[0-9a-fA-F]+$/);
  console.log("[setup-only] global state OK");
  console.log(JSON.stringify(state, null, 2));
});
