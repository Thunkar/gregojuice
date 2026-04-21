import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readState,
  writeState,
  hasState,
  STATE_FILES,
  type GlobalState,
  type SwapDeploymentState,
} from "../fixtures/state.ts";
import { getPublicFeeJuiceBalance } from "../fixtures/fee-juice-balance.ts";

/**
 * Spec 03 — deploy the swap contracts as swap-admin, paying with native FJ.
 *
 * We run `apps/swap/scripts/deploy.ts` as a Node subprocess rather than
 * importing `runSwapDeploy` in-process. Reason: the deploy script imports
 * contract artifacts from `@gregojuice/aztec/artifacts/*`, whose source
 * `.ts` files use `public declare` class fields. Playwright's bundled
 * Babel transformer rejects those (requires a specific plugin order); plain
 * Node with `--experimental-transform-types` handles them fine. The
 * subprocess also neatly isolates the contract artifact imports from the
 * test worker.
 *
 * Output is written to `apps/swap/src/config/networks/local.json`; we read
 * that back and mirror the relevant bits into the `swapDeployment` state file.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const SWAP_DIR = resolve(REPO_ROOT, "apps/swap");
const SWAP_LOCAL_JSON = resolve(SWAP_DIR, "src/config/networks/local.json");

function runDeploy(env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(
      "node",
      [
        "--experimental-transform-types",
        "scripts/deploy.ts",
        "--network",
        "local",
        "--payment",
        "feejuice",
      ],
      { cwd: SWAP_DIR, env, stdio: "inherit" },
    );
    child.on("exit", (code) => {
      if (code === 0) res();
      else rej(new Error(`deploy.ts exited with code ${code}`));
    });
    child.on("error", rej);
  });
}

test.describe.serial("swap deploy", () => {
  test.slow();

  test("deploys swap contracts as swap-admin paying with fee juice", async () => {
    test.skip(
      hasState(STATE_FILES.swapDeployment),
      `checkpoint exists at ${STATE_FILES.swapDeployment}`,
    );
    const global = await readState<GlobalState>(STATE_FILES.global);

    // Sanity: the account that spec 02 funded should still have FJ.
    const preBalance = await getPublicFeeJuiceBalance(global.nodeUrl, global.swapAdmin.address);
    console.log(`[e2e] swap-admin FJ before deploy = ${preBalance}`);
    expect(preBalance).toBeGreaterThan(0n);

    // The PoP contract bakes the password into its storage at deploy time,
    // so capture whatever we used here and persist it alongside the rest of
    // the deployment state. Downstream specs read it from there rather than
    // hardcoding their own copy.
    const password = process.env.PASSWORD ?? "potato";

    await runDeploy({
      ...process.env,
      SWAP_ADMIN_SECRET: global.swapAdmin.secret,
      PASSWORD: password,
    });

    const raw = await readFile(SWAP_LOCAL_JSON, "utf-8");
    const deployed = JSON.parse(raw) as {
      chainId: string;
      rollupVersion: string;
      contracts: {
        gregoCoin: string;
        gregoCoinPremium: string;
        amm: string;
        liquidityToken: string;
        pop: string;
        salt: string;
      };
      deployer: { address: string };
    };

    expect(deployed.deployer.address.toLowerCase()).toBe(global.swapAdmin.address.toLowerCase());

    const state: SwapDeploymentState = {
      gregoCoin: deployed.contracts.gregoCoin,
      gregoCoinPremium: deployed.contracts.gregoCoinPremium,
      liquidityToken: deployed.contracts.liquidityToken,
      amm: deployed.contracts.amm,
      pop: deployed.contracts.pop,
      contractSalt: deployed.contracts.salt,
      deployerAddress: deployed.deployer.address,
      rollupVersion: deployed.rollupVersion,
      password,
    };
    await writeState(STATE_FILES.swapDeployment, state);
    console.log(`[e2e] wrote ${STATE_FILES.swapDeployment}`);
  });
});
