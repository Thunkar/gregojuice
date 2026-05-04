/**
 * Token balances
 */
export interface Balances {
  goCoin: bigint | null;
  goCoinPremium: bigint | null;
}

export const GOCOIN_USD_PRICE = 10;
export const EXCHANGE_RATE_POLL_INTERVAL_MS = 10000;
