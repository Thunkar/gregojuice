import type { FeeStats } from "./fetchFeeStats.ts";

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
