/**
 * Shared on-disk state for e2e specs.
 *
 * Each setup phase writes to its own file under `e2e/.state/`, and later specs
 * (possibly running in a different Playwright project) read what they need.
 * Kept as plain files so debugging a failed run is a matter of catting a file
 * rather than inspecting Playwright's worker state.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const STATE_DIR = resolve(ROOT, ".state");

export const STATE_FILES = {
  global: resolve(STATE_DIR, "global.json"),
  fpc: resolve(STATE_DIR, "fpc.json"),
  swap: resolve(STATE_DIR, "swap.json"),
} as const;

/** Shape written by `global-setup` before any spec runs. */
export interface GlobalState {
  nodeUrl: string;
  l1RpcUrl: string;
  chainId: number;
  /** Deployed GregoJuiceBridge contract address on L1. */
  l1BridgeAddress: string;
  /** Deterministic swap-admin secret + derived L2 address. */
  swapAdmin: { secret: string; address: string };
}

/** Shape written after spec 01 finishes (fpc-dashboard setup). */
export interface FpcState {
  fpcAddress: string;
  fpcAdminAddress: string;
  /** Contents of the BackupRestore JSON export. */
  backup: unknown;
  signedUp?: {
    [functionKey: string]: {
      contractAddress: string;
      functionName: string;
      selector: string;
      configIndex: number;
    };
  };
}

/** Shape written after spec 03 (swap deploy) finishes. */
export interface SwapState {
  gregoCoin: string;
  gregoCoinPremium: string;
  liquidityToken: string;
  amm: string;
  pop: string;
  contractSalt: string;
  deployerAddress: string;
  rollupVersion: string;
}

export async function writeState<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

export async function readState<T>(path: string): Promise<T> {
  if (!existsSync(path)) throw new Error(`state file missing: ${path}`);
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

/** Wipes the `.state/` dir. Called by global-setup at the start of a run. */
export async function resetStateDir(): Promise<void> {
  await rm(STATE_DIR, { recursive: true, force: true });
  await mkdir(STATE_DIR, { recursive: true });
}
