/** Shared profiling types. */

export type Category = "wallet" | "pxe" | "sim" | "oracle" | "store" | "node" | "rpc" | "wasm";

export interface ProfileRecord {
  /** Unique span id. Always present. */
  id: string;
  /** Parent span id from async context, or null for root spans. */
  parentId: string | null;
  name: string;
  category: Category;
  /** ms from recording origin. */
  start: number;
  /** ms duration. */
  duration: number;
  detail?: string;
  error?: boolean;
}

export interface ProfileReport {
  name: string;
  /** Date.now() at recording start. */
  startedAt: number;
  durationMs: number;
  records: ProfileRecord[];
}
