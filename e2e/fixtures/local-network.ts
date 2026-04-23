import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spawns `aztec start --local-network` for the test run. This brings up
 * Anvil (L1, :8545) plus the Aztec node (:8080) and supporting services, so
 * both L2 flows and bridge flows can hit a real stack.
 */
export interface LocalNetwork {
  workDir: string;
  nodeUrl: string;
  l1RpcUrl: string;
  stop: () => Promise<void>;
}

const DEFAULT_NODE_URL = "http://localhost:8080";
const DEFAULT_L1_RPC_URL = "http://localhost:8545";
const READINESS_TIMEOUT_MS = 180_000;

export async function startLocalNetwork(): Promise<LocalNetwork> {
  const workDir = await mkdtemp(join(tmpdir(), "gj-e2e-"));
  const proc: ChildProcess = spawn("aztec", ["start", "--local-network"], {
    cwd: workDir,
    env: { ...process.env, AZTEC_WORKDIR: workDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Drain stdout/stderr to a file. Unconsumed pipes fill their OS buffer
  // (~64KB on Linux) and then BLOCK the child on its next write — the node
  // appears healthy on HTTP until its internal log flush backs up enough to
  // stall the event loop, at which point it stops serving requests and dies.
  // CI trips this easily (higher log volume, no interactive terminal).
  //
  // Write under e2e/playwright-report/ so the CI upload-artifact step picks
  // the log up on failure, instead of losing it to the ephemeral $TMPDIR.
  const reportDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "playwright-report");
  await mkdir(reportDir, { recursive: true });
  const logPath = join(reportDir, "aztec.log");
  const logStream = createWriteStream(logPath, { flags: "a" });
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  try {
    await Promise.all([
      waitForReady(proc, DEFAULT_L1_RPC_URL, "L1 RPC"),
      waitForReady(proc, DEFAULT_NODE_URL, "Aztec node"),
    ]);
  } catch (err) {
    proc.kill("SIGTERM");
    throw err;
  }

  return {
    workDir,
    nodeUrl: DEFAULT_NODE_URL,
    l1RpcUrl: DEFAULT_L1_RPC_URL,
    stop: async () => {
      proc.kill("SIGTERM");
      await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
      logStream.end();
      await rm(workDir, { recursive: true, force: true });
    },
  };
}

async function waitForReady(proc: ChildProcess, url: string, label: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`local-network exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(url, { method: "POST", body: "{}" });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}
