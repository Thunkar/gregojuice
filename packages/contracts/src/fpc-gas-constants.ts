/**
 * Gas constants for manual calibration of sponsored transactions.
 *
 * When operators can't run a full simulation calibration, they can compute
 * the sponsored gas limits from a standalone simulation + these constants.
 *
 * For PUBLIC sponsored functions (no repricing needed):
 *   gasLimits     = standalone.gasLimits + FPC_OVERHEAD
 *   teardownLimits = FPC_TEARDOWN
 *
 * For PRIVATE sponsored functions (repricing required):
 *   gasLimits     = standalone.gasLimits
 *                 + PRIVATE_TO_PUBLIC_OVERHEAD_DIFF
 *                 + FPC_OVERHEAD
 *                 + repricePrivateSideEffects(noteHashes, nullifiers, l2ToL1Msgs)
 *   teardownLimits = FPC_TEARDOWN
 *
 * These constants are derived from @aztec/constants and stay in sync automatically.
 * The FPC overhead itself is measured by the fpc-overhead test.
 */

import {
  AVM_EMITNOTEHASH_BASE_L2_GAS,
  AVM_EMITNULLIFIER_BASE_L2_GAS,
  AVM_SENDL2TOL1MSG_BASE_L2_GAS,
  L2_GAS_PER_NOTE_HASH,
  L2_GAS_PER_NULLIFIER,
  L2_GAS_PER_L2_TO_L1_MSG,
  PRIVATE_TX_L2_GAS_OVERHEAD,
  PUBLIC_TX_L2_GAS_OVERHEAD,
} from "@aztec/constants";

// ── Side-effect repricing (private → AVM rates) ──────────────────────
// When a tx has public calls (all sponsored txs do, due to _ensure_max_fee teardown),
// private side effects are charged at AVM rates instead of private rates.

/** L2 gas rate difference per note hash */
export const NOTE_HASH_L2_RATE_DIFF =
  AVM_EMITNOTEHASH_BASE_L2_GAS - L2_GAS_PER_NOTE_HASH;

/** L2 gas rate difference per nullifier */
export const NULLIFIER_L2_RATE_DIFF =
  AVM_EMITNULLIFIER_BASE_L2_GAS - L2_GAS_PER_NULLIFIER;

/** L2 gas rate difference per L2→L1 message */
export const L2_TO_L1_MSG_L2_RATE_DIFF =
  AVM_SENDL2TOL1MSG_BASE_L2_GAS - L2_GAS_PER_L2_TO_L1_MSG;

// ── Base overhead difference ─────────────────────────────────────────
// Private-only txs use PRIVATE_TX_L2_GAS_OVERHEAD.
// Txs with public calls use PUBLIC_TX_L2_GAS_OVERHEAD.
// All sponsored txs have public calls (the teardown), so this diff always applies
// when going from a standalone private simulation to a sponsored tx.

/** L2 gas overhead difference */
export const PRIVATE_TO_PUBLIC_L2_OVERHEAD_DIFF =
  PUBLIC_TX_L2_GAS_OVERHEAD - PRIVATE_TX_L2_GAS_OVERHEAD;

// ── FPC overhead (measured by fpc-overhead test) ─────────────────────
// Subscribe is more expensive than sponsor because it pops a SlotNote
// and creates a SubscriptionNote, while sponsor pops and re-inserts
// a SubscriptionNote. The max_fee must cover subscribe (the more expensive call).
//
// Measured as: fpc_public_gas - standalone_public_gas (no repricing needed).
// If the test fails with a mismatch, update these values from the test output.

/** Subscribe overhead on L2 gas (first call — pops slot, re-inserts, creates subscription) */
export const FPC_SUBSCRIBE_OVERHEAD_L2_GAS = 115279;

/** Subscribe overhead on DA gas */
export const FPC_SUBSCRIBE_OVERHEAD_DA_GAS = 1216;

/** Sponsor overhead on L2 gas (subsequent calls — pops subscription, re-inserts) */
export const FPC_SPONSOR_OVERHEAD_L2_GAS = 93504;

/** Sponsor overhead on DA gas */
export const FPC_SPONSOR_OVERHEAD_DA_GAS = 640;

/** FPC teardown L2 gas (_ensure_max_fee — constant across all FPC calls) */
export const FPC_TEARDOWN_L2_GAS = 4623;

/** FPC teardown DA gas */
export const FPC_TEARDOWN_DA_GAS = 0;

// ── Repricing utility ────────────────────────────────────────────────

/**
 * Computes the L2 gas repricing correction for a private function being sponsored.
 *
 * When a private function is called through the FPC, its side effects get
 * charged at AVM rates instead of private rates. This function computes the
 * additional L2 gas cost from that repricing.
 *
 * @param noteHashes - Number of note hashes the function emits
 * @param nullifiers - Number of nullifiers the function emits (excluding protocol nullifier)
 * @param l2ToL1Msgs - Number of L2→L1 messages the function emits
 * @returns Additional L2 gas from repricing
 */
export function repricePrivateSideEffects(
  noteHashes: number,
  nullifiers: number,
  l2ToL1Msgs: number = 0,
): number {
  return (
    noteHashes * NOTE_HASH_L2_RATE_DIFF +
    nullifiers * NULLIFIER_L2_RATE_DIFF +
    l2ToL1Msgs * L2_TO_L1_MSG_L2_RATE_DIFF
  );
}
