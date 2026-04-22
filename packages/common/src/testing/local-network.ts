/**
 * In-process local-network fixture.
 *
 * Mirrors the flow in `aztec-packages/yarn-project/end-to-end/src/fixtures/setup.ts`:
 * spawn anvil, deploy L1 contracts with automining, swap to interval mining,
 * start the watcher, start `AztecNodeService`. The wins:
 *
 *   1. `fundedAddresses` are pre-funded in genesis — no bridging step.
 *   2. Each call spawns its own anvil on a random port, so suites can run
 *      in parallel without fighting over 8545.
 *
 * We inline our own `startAnvil` because the copy in `@aztec/ethereum/test`
 * shells out to `scripts/anvil_kill_wrapper.sh`, which isn't shipped in the
 * published npm tarball.
 */

import { AztecNodeService } from "@aztec/aztec-node";
import { getConfigEnvVars as getAztecNodeConfigEnvVars } from "@aztec/aztec-node/config";
import type { AztecNodeConfig } from "@aztec/aztec-node/config";
import { Fr } from "@aztec/aztec.js/fields";
import { GENESIS_ARCHIVE_ROOT } from "@aztec/constants";
import { getL1ContractsConfigEnvVars } from "@aztec/ethereum/config";
import { deployAztecL1Contracts } from "@aztec/ethereum/deploy-aztec-l1-contracts";
import { EthCheatCodesWithState } from "@aztec/ethereum/test";
import { SecretValue } from "@aztec/foundation/config";
import { EthAddress } from "@aztec/foundation/eth-address";
import { TestDateProvider } from "@aztec/foundation/timer";
import { getVKTreeRoot } from "@aztec/noir-protocol-circuits-types/vk-tree";
import { protocolContractsHash } from "@aztec/protocol-contracts";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  initTelemetryClient,
  getConfigEnvVars as getTelemetryConfig,
} from "@aztec/telemetry-client";
import { getGenesisValues } from "@aztec/world-state/testing";
import { AnvilTestWatcher } from "@aztec/aztec/testing";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

export interface LocalNetwork {
  /** Fully-synced Aztec node, ready to serve client requests. */
  node: AztecNodeService;
  /** RPC URL of the spawned anvil instance. */
  l1RpcUrl: string;
  /** Chain id used on L1 (foundry's default 31337). */
  l1ChainId: number;
  /** Stops every process started by the fixture: node, watcher, anvil. */
  stop: () => Promise<void>;
}

export interface LocalNetworkOptions {
  /**
   * Addresses that should hold fee juice at genesis. Saves each of these
   * the round-trip of bridging + claiming FJ before they can pay for gas.
   */
  fundedAddresses?: AztecAddress[];
  /** Override the default 1e18 FJ per funded address. */
  initialAccountFeeJuice?: Fr;
}

/**
 * Inline replacement for `@aztec/ethereum/test`'s `startAnvil`. Picks a
 * random OS-assigned port and spawns `anvil` directly (no shell wrapper).
 */
async function startAnvil(opts: { l1BlockTime?: number } = {}): Promise<{
  rpcUrl: string;
  stop: () => Promise<void>;
}> {
  const port = await reservePort();
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--accounts",
    "20",
    "--gas-limit",
    "45000000",
    "--chain-id",
    "31337",
  ];
  if (opts.l1BlockTime !== undefined) {
    args.push("--block-time", String(opts.l1BlockTime));
  }

  const child = spawn("anvil", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, RAYON_NUM_THREADS: "1" },
  });

  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const onStdout = (data: Buffer) => {
      if (data.toString().includes("Listening on")) {
        child.stdout?.removeListener("data", onStdout);
        child.stderr?.removeListener("data", onStderr);
        child.removeListener("close", onClose);
        resolve();
      }
    };
    const onStderr = (data: Buffer) => {
      stderr += data.toString();
    };
    const onClose = (code: number | null) => {
      reject(new Error(`anvil exited with code ${code} before listening. stderr: ${stderr}`));
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("close", onClose);
  });

  child.stdout?.resume();
  child.stderr?.resume();

  return { rpcUrl: `http://127.0.0.1:${port}`, stop: () => killChild(child) };
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not reserve port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.killed) {
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
      return;
    }
    const onClose = () => {
      clearTimeout(killTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
    };
    child.once("close", onClose);
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    killTimer.unref();
  });
}

/**
 * Spawn a full in-process local network with the given addresses pre-funded.
 * Caller must `await result.stop()` in its teardown.
 */
export async function setupLocalNetwork(opts: LocalNetworkOptions = {}): Promise<LocalNetwork> {
  // ── 1. Anvil. No --block-time: the setup automines for L1 deploy and
  //    then switches to interval mining at `ethereumSlotDuration`.
  const { rpcUrl, stop: stopAnvil } = await startAnvil();
  const l1ChainId = foundry.id;

  // ── 2. L1 publisher key (foundry default mnemonic) ─────────────────
  const hdAccount = mnemonicToAccount(DEFAULT_MNEMONIC);
  const privateKey: Hex = `0x${Buffer.from(hdAccount.getHdKey().privateKey!).toString("hex")}`;

  // ── 3. Base node config ────────────────────────────────────────────
  //    Aligned with the e2e reference: test-only flags, fixed coinbase,
  //    minTxsPerBlock=1 so account-deploy txs land reliably in block 1.
  const config: AztecNodeConfig = {
    ...getAztecNodeConfigEnvVars(),
    l1RpcUrls: [rpcUrl],
    l1ChainId,
    sequencerPublisherPrivateKeys: [new SecretValue<Hex>(privateKey)],
    validatorPrivateKeys: new SecretValue<Hex[]>([privateKey]),
    coinbase: EthAddress.fromString(privateKeyToAddress(privateKey)),
    realProofs: false,
    enforceTimeTable: false,
    enableDelayer: true,
    listenAddress: "127.0.0.1",
    minTxPoolAgeMs: 0,
    minTxsPerBlock: 1,
    aztecTargetCommitteeSize: 0,
  };

  // ── 4. Genesis ─────────────────────────────────────────────────────
  const fundedAddresses = opts.fundedAddresses ?? [];
  const { genesisArchiveRoot, prefilledPublicData, fundingNeeded } = await getGenesisValues(
    fundedAddresses,
    opts.initialAccountFeeJuice,
  );

  // ── 5. L1 deployment. Anvil is automining by default (no `--block-time`
  //    passed), which matches the reference setup where
  //    `automineL1Setup` is left undefined.
  const dateProvider = new TestDateProvider();

  const deployL1 = await deployAztecL1Contracts(rpcUrl, privateKey, l1ChainId, {
    ...getL1ContractsConfigEnvVars(),
    ...config,
    vkTreeRoot: getVKTreeRoot(),
    protocolContractsHash,
    genesisArchiveRoot: fundedAddresses.length ? genesisArchiveRoot : new Fr(GENESIS_ARCHIVE_ROOT),
    feeJuicePortalInitialBalance: fundingNeeded,
    realVerifier: false,
  });
  config.l1Contracts = deployL1.l1ContractAddresses;
  config.rollupVersion = deployL1.rollupVersion;

  // ── 6. Watcher ─────────────────────────────────────────────────────
  const watcher = new AnvilTestWatcher(
    new EthCheatCodesWithState([rpcUrl], dateProvider),
    deployL1.l1ContractAddresses.rollupAddress,
    deployL1.l1Client,
    dateProvider,
  );
  await watcher.start();

  // ── 7. Node ────────────────────────────────────────────────────────
  const telemetry = await initTelemetryClient(getTelemetryConfig());
  const node = await AztecNodeService.createAndSync(
    config,
    { telemetry, dateProvider },
    { prefilledPublicData },
  );

  const stop = async () => {
    await node.stop();
    await watcher.stop();
    await stopAnvil();
  };

  return { node, l1RpcUrl: rpcUrl, l1ChainId, stop };
}
