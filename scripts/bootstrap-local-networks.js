#!/usr/bin/env node

/**
 * Generate `apps/<app>/src/config/networks/local.json` for apps that need a
 * local-network entry. Idempotent: if a file already exists it's left alone
 * unless you pass --force.
 *
 * - bridge + fpc-operator both use the same shape: { id, name, aztecNodeUrl,
 *   l1RpcUrl, l1ChainId }. Standard local values are good defaults.
 * - swap uses a richer shape that requires deployed contract addresses; we
 *   don't fabricate those here — that's what `yarn deploy:local` (or the e2e
 *   setup chain) produces.
 *
 * Usage:
 *   node scripts/bootstrap-local-networks.js            # create missing files
 *   node scripts/bootstrap-local-networks.js --force    # overwrite existing
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

function log(color, msg) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

const force = process.argv.includes("--force");

/**
 * Apps whose local.json is a fixed shape with known defaults. These get
 * written verbatim.
 */
const FIXED_LOCAL_CONFIGS = {
  bridge: {
    id: "local",
    name: "Local Network",
    aztecNodeUrl: "http://localhost:8080",
    l1RpcUrl: "http://localhost:8545",
    l1ChainId: 31337,
  },
  "fpc-operator": {
    id: "local",
    name: "Local Network",
    aztecNodeUrl: "http://localhost:8080",
    l1RpcUrl: "http://localhost:8545",
    l1ChainId: 31337,
  },
};

function writeLocalConfig(appName, config) {
  const target = resolve(ROOT, "apps", appName, "src/config/networks/local.json");
  if (existsSync(target) && !force) {
    log(
      COLORS.gray,
      `  - ${appName}/local.json already exists — skipping (use --force to overwrite)`,
    );
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log(COLORS.green, `  ✓ wrote ${appName}/local.json`);
}

log(COLORS.yellow, "Bootstrapping local network configs...");
for (const [appName, config] of Object.entries(FIXED_LOCAL_CONFIGS)) {
  writeLocalConfig(appName, config);
}

// swap's local.json requires deployed contract addresses — left to deploy:local
// or the e2e setup chain.
const swapLocalPath = resolve(ROOT, "apps/swap/src/config/networks/local.json");
if (existsSync(swapLocalPath)) {
  log(COLORS.gray, "  - swap/local.json already exists (contracts deployed)");
} else {
  log(
    COLORS.gray,
    "  - swap/local.json missing — generate via `yarn workspace @gregojuice/swap deploy:local` or run the e2e setup chain.",
  );
}

log(COLORS.green, "Done.");
