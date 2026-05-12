/**
 * Dev-only inspector for SQLite-OPFS stores. When registered, exposes
 * `window.__aztecStores` with ad-hoc query + export helpers so the DB contents
 * can be examined from the browser DevTools console. No-op in SSR.
 */

import type { AztecAsyncKVStore } from "@aztec/kv-store";
import { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs";

// Plaintext SQLite files start with this ASCII magic + null terminator.
// Hex form: 53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00
const SQLITE_MAGIC_HEX = "53514c69746520666f726d6174203300";

interface InspectableStore extends AztecAsyncKVStore {
  allAsync(sql: string, bind?: unknown[]): Promise<unknown[][]>;
  exportDb(): Promise<Uint8Array>;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

async function summarize(
  store: InspectableStore,
): Promise<Array<{ container: string; rows: number }>> {
  const rows = await store.allAsync(
    "SELECT container, count(*) AS n FROM data GROUP BY container ORDER BY n DESC",
  );
  return rows.map((r) => ({ container: String(r[0]), rows: Number(r[1]) }));
}

export type SqliteInspectors = {
  pxe: InspectableStore;
  wallet: InspectableStore;
  downloadPxe(): Promise<void>;
  downloadWallet(): Promise<void>;
  summary(): Promise<{
    pxe: Array<{ container: string; rows: number }>;
    wallet: Array<{ container: string; rows: number }>;
  }>;
};

export function registerSqliteInspectors(stores: {
  pxe: InspectableStore;
  wallet: InspectableStore;
}): void {
  if (typeof window === "undefined") return;
  const inspectors: SqliteInspectors = {
    pxe: stores.pxe,
    wallet: stores.wallet,
    downloadPxe: async () => downloadBytes(await stores.pxe.exportDb(), "pxe.sqlite"),
    downloadWallet: async () => downloadBytes(await stores.wallet.exportDb(), "wallet.sqlite"),
    summary: async () => ({
      pxe: await summarize(stores.pxe),
      wallet: await summarize(stores.wallet),
    }),
  };
  (window as unknown as { __aztecStores: SqliteInspectors }).__aztecStores = inspectors;
}

/**
 * Debug helper: checks whether the underlying SQLite file looks encrypted.
 *
 * Detection heuristic: sqlite3mc page-level encryption (when enabled) encrypts
 * the entire database file, including the SQLite magic header at offset 0.
 * A plaintext file always starts with the ASCII bytes "SQLite format 3\0".
 * If those 16 bytes are something else, the file is almost certainly encrypted.
 *
 * Returns `{ applicable: false }` for non-sqlite-opfs stores (e.g. IndexedDB,
 * LMDB) where the concept doesn't apply.
 */
export async function peekEncryption(
  store: AztecAsyncKVStore,
): Promise<
  | { applicable: false }
  | { applicable: true; encrypted: boolean; firstBytesHex: string }
> {
  if (!(store instanceof AztecSQLiteOPFSStore)) {
    return { applicable: false };
  }
  const bytes = await store.exportDb();
  const first16 = Array.from(bytes.slice(0, 16), b =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    applicable: true,
    encrypted: first16 !== SQLITE_MAGIC_HEX,
    firstBytesHex: first16,
  };
}
