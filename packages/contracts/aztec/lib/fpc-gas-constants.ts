/**
 * Gas constants for manual calibration of sponsored transactions.
 *
 * For operators who compute sponsored gas limits from a standalone gas
 * estimate:
 *
 *   gasLimits      = standalone.gasLimits + FPC_{SPONSOR,SUBSCRIBE}_OVERHEAD
 *   teardownLimits = 0
 *
 * The overhead depends on whether the sponsored function has an enqueued
 * public call:
 *
 *   - Sponsored function is private-only → use the `*_PRIVATE` overhead.
 *   - Sponsored function has a public call → use the `*_PUBLIC` overhead.
 *
 * The two differ by ≈70k L2 gas for `subscribe` and ≈61k L2 gas for `sponsor`.
 * The FPC emits its own private side effects (note hashes + nullifiers from
 * `sponsor`/`subscribe` bookkeeping) and those get charged at AVM rates
 * whenever the tx contains a public call.
 *
 * The standalone measurement already bakes in the pricing regime appropriate
 * to the sponsored function, so `standalone + FPC_*_OVERHEAD` is the complete
 * answer — no further repricing needed on the caller side.
 *
 * Measurements live in `fpc-overhead.test.ts`, which pins these values
 * against a real deployment.
 */

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

/** FPC teardown L2 gas */
export const FPC_TEARDOWN_L2_GAS = 0;

/** FPC teardown DA gas */
export const FPC_TEARDOWN_DA_GAS = 0;
