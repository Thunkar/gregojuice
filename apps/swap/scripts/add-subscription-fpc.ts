/**
 * Adds subscriptionFPC config to a network config file.
 *
 * Usage:
 *   node --experimental-transform-types scripts/add-subscription-fpc.ts \
 *     --network testnet \
 *     --fpc-address 0x... \
 *     --fpc-secret 0x...
 *
 * This computes the function selectors for:
 *   - check_password_and_mint on the PoP contract
 *   - swap_tokens_for_exact_tokens_from on the AMM contract
 * and writes them to the network config with configIndex=0.
 */

import fs from "fs";
import path from "path";
import { FunctionSelector } from "@aztec/stdlib/abi";

import { ProofOfPasswordContractArtifact } from "@gregojuice/aztec/artifacts/ProofOfPassword";
import { AMMContractArtifact } from "@gregojuice/aztec/artifacts/AMM";

function getArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string => {
    const idx = args.indexOf(name);
    if (idx === -1 || idx === args.length - 1) {
      console.error(`Missing ${name}`);
      process.exit(1);
    }
    return args[idx + 1];
  };
  return {
    network: get("--network"),
    fpcAddress: get("--fpc-address"),
    fpcSecret: get("--fpc-secret"),
  };
}

async function main() {
  const { network, fpcAddress, fpcSecret } = getArgs();

  const configPath = path.join(import.meta.dirname, "../src/config/networks", `${network}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Network config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Compute selectors from artifacts
  const popFn = ProofOfPasswordContractArtifact.functions.find(
    (f) => f.name === "check_password_and_mint",
  );
  if (!popFn) throw new Error("check_password_and_mint not found in ProofOfPassword artifact");
  const popSelector = await FunctionSelector.fromNameAndParameters(popFn.name, popFn.parameters);

  const ammFn = AMMContractArtifact.functions.find(
    (f) => f.name === "swap_tokens_for_exact_tokens_from",
  );
  if (!ammFn) throw new Error("swap_tokens_for_exact_tokens_from not found in AMM artifact");
  const ammSelector = await FunctionSelector.fromNameAndParameters(ammFn.name, ammFn.parameters);

  console.log(`PoP contract: ${config.contracts.pop}`);
  console.log(`  check_password_and_mint selector: ${popSelector.toString()}`);
  console.log(`AMM contract: ${config.contracts.amm}`);
  console.log(`  swap_tokens_for_exact_tokens_from selector: ${ammSelector.toString()}`);

  // Build the subscriptionFPC config
  config.subscriptionFPC = {
    address: fpcAddress,
    secretKey: fpcSecret,
    functions: {
      [config.contracts.pop]: {
        [popSelector.toString()]: 0,
      },
      [config.contracts.amm]: {
        [ammSelector.toString()]: 0,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nUpdated ${configPath} with subscriptionFPC config.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
