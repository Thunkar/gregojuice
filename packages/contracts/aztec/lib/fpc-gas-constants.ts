/**
 * Gas constants for manual calibration of sponsored transactions.
 *
 * When operators can't run a full simulation calibration, they can compute
 * the sponsored gas limits from a standalone simulation + these constants:
 *
 *   gasLimits      = standalone.gasLimits + FPC_{SPONSOR,SUBSCRIBE}_OVERHEAD
 *   teardownLimits = 0  (setup-gate design — no teardown fn)
 *
 * IMPORTANT: the overhead depends on whether the sponsored function has any
 * enqueued public calls.
 *
 *   - Sponsored function is **private-only** → tx stays private → use the
 *     `*_PRIVATE` overhead.
 *   - Sponsored function is **public** (or private-with-enqueued-public) →
 *     tx has public calls → use the `*_PUBLIC` overhead.
 *
 * The gap between the two (≈70k L2 for subscribe, ≈61k L2 for sponsor) comes
 * from the FPC's **own** private side effects (note hashes + nullifiers it
 * emits in sponsor/subscribe) being repriced at AVM rates when the tx
 * contains a public call. The FPC itself doesn't enqueue any public calls,
 * but the sponsored public call flips the whole tx into the public-pricing
 * regime and the FPC's side effects get caught in the repricing.
 *
 * See `fpc-overhead.test.ts` for the measurement — the "private vs public"
 * invariant test documents this gap and would catch a regression if the FPC
 * ever starts enqueueing a public call itself (which would equalize the two
 * at the higher value).
 *
 * These constants are derived from @aztec/constants and stay in sync automatically.
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
// When a tx has public calls, private side effects are charged at AVM rates
// instead of private rates. This is a property of the sponsored function
// itself (does it run public code or enqueue public calls?) — the FPC does
// not change it.

/** L2 gas rate difference per note hash */
export const NOTE_HASH_L2_RATE_DIFF = AVM_EMITNOTEHASH_BASE_L2_GAS - L2_GAS_PER_NOTE_HASH;

/** L2 gas rate difference per nullifier */
export const NULLIFIER_L2_RATE_DIFF = AVM_EMITNULLIFIER_BASE_L2_GAS - L2_GAS_PER_NULLIFIER;

/** L2 gas rate difference per L2→L1 message */
export const L2_TO_L1_MSG_L2_RATE_DIFF = AVM_SENDL2TOL1MSG_BASE_L2_GAS - L2_GAS_PER_L2_TO_L1_MSG;

// ── Base overhead difference ─────────────────────────────────────────
// Private-only txs use PRIVATE_TX_L2_GAS_OVERHEAD.
// Txs with public calls use PUBLIC_TX_L2_GAS_OVERHEAD.
// Whether either applies to a sponsored tx is determined by the sponsored
// function, not by the FPC.

/** L2 gas overhead difference */
export const PRIVATE_TO_PUBLIC_L2_OVERHEAD_DIFF =
  PUBLIC_TX_L2_GAS_OVERHEAD - PRIVATE_TX_L2_GAS_OVERHEAD;

// ── FPC overhead (measured by fpc-overhead test) ─────────────────────
// Subscribe is more expensive than sponsor because it pops a SlotNote
// and creates a SubscriptionNote, while sponsor pops and re-inserts
// a SubscriptionNote. The max_fee must cover subscribe (the more expensive call).
//
// Each of the four overheads is measured as:
//   fpc_{public,private}_gas - standalone_{public,private}_gas
// The public variant is larger because the FPC's own private side effects
// (note hashes + nullifiers it emits) get repriced at AVM rates whenever the
// tx contains a public call from the sponsored function.
//
// If the test fails with a mismatch, update these values from the test output.

/** Subscribe overhead on L2 gas when the sponsored fn is private-only */
export const FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE = 39400;

/** Subscribe overhead on DA gas when the sponsored fn is private-only */
export const FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE = 1184;

/** Subscribe overhead on L2 gas when the sponsored fn has a public call */
export const FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC = 110656;

/** Subscribe overhead on DA gas when the sponsored fn has a public call */
export const FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC = 1216;

/** Sponsor overhead on L2 gas when the sponsored fn is private-only */
export const FPC_SPONSOR_OVERHEAD_L2_GAS_PRIVATE = 27700;

/** Sponsor overhead on DA gas when the sponsored fn is private-only */
export const FPC_SPONSOR_OVERHEAD_DA_GAS_PRIVATE = 608;

/** Sponsor overhead on L2 gas when the sponsored fn has a public call */
export const FPC_SPONSOR_OVERHEAD_L2_GAS_PUBLIC = 88881;

/** Sponsor overhead on DA gas when the sponsored fn has a public call */
export const FPC_SPONSOR_OVERHEAD_DA_GAS_PUBLIC = 640;

/** FPC teardown L2 gas (zero — max_fee is enforced in setup, no teardown fn) */
export const FPC_TEARDOWN_L2_GAS = 0;

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
