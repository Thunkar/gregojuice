/**
 * Network-fee statistics from the clustec public API + a helper that turns
 * calibration gas limits into a padded FJ `maxFee` (P75 of the last N blocks,
 * multiplied by a safety factor).
 *
 * Used by the fpc-operator UI for operator-facing calibration, and by the
 * swap app's deploy scripts to pick a sensible `maxFee` for automated sign_ups.
 */

interface StatBucket {
  min: string;
  max: string;
  mean: string;
  median: string;
  p75: string;
}

export interface FeeStats {
  blockRange: { from: number; to: number };
  txCount: number;
  actualFee: StatBucket;
  gasLimitDa: StatBucket;
  gasLimitL2: StatBucket;
  maxFeePerDaGas: StatBucket;
  maxFeePerL2Gas: StatBucket;
  baseFee: { da: string; l2: string };
}

/** Queries the clustec public API for aggregated fee stats over the last N blocks. */
export async function fetchFeeStats(networkId: string, blocks = 100): Promise<FeeStats> {
  const res = await fetch(
    `https://api.clustec.xyz/networks/${networkId}/fees/stats?blocks=${blocks}`,
  );
  if (!res.ok) throw new Error(`Fee stats request failed: ${res.status}`);
  return res.json();
}

export interface GasLimits {
  daGas: number;
  l2Gas: number;
}

/**
 * Computes a padded `maxFee` (in raw FJ wei, as a bigint) from calibrated gas
 * limits + the P75 of per-gas prices observed on-chain.
 *
 *   maxFee = ((daGas + teardownDaGas) * feePerDaGas + (l2Gas + teardownL2Gas) * feePerL2Gas) * multiplier
 *
 * Callers usually pass `multiplier = 2` (the dashboard default).
 */
export function computeMaxFeeFromP75(
  gasLimits: GasLimits,
  teardownGasLimits: GasLimits,
  stats: FeeStats,
  multiplier = 2,
): bigint {
  const totalDaGas = BigInt(gasLimits.daGas + teardownGasLimits.daGas);
  const totalL2Gas = BigInt(gasLimits.l2Gas + teardownGasLimits.l2Gas);
  const feePerDaGas = BigInt(Math.round(Number(stats.maxFeePerDaGas.p75)));
  const feePerL2Gas = BigInt(Math.round(Number(stats.maxFeePerL2Gas.p75)));
  const baseFee = totalDaGas * feePerDaGas + totalL2Gas * feePerL2Gas;
  const multiplierBp = BigInt(Math.round(multiplier * 100));
  return (baseFee * multiplierBp) / 100n;
}
