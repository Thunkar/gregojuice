/**
 * Network-fee statistics queried from the clustec public API. Used by the
 * fpc-operator UI for operator-facing calibration, and by the swap app's
 * deploy scripts to pick a sensible `maxFee` for automated sign_ups.
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
