/**
 * Token balances
 */
export interface Balances {
  gregoCoin: bigint | null;
  gregoCoinPremium: bigint | null;
}

export const GREGOCOIN_USD_PRICE = 10;
export const EXCHANGE_RATE_POLL_INTERVAL_MS = 10000;
