# Part B: FPC Operator App Redesign

## Overview

Redesign the fpc-operator app with a proper two-phase flow, fee pricing tools, and margin calculator.

## Two-phase app flow

### Setup phase (linear stepper — shown until FPC is loaded)
1. Initializing wallet... (auto)
2. Fund admin account (bridge iframe with `?recipients=adminAddr,amount`)
3. Deploy FPC (button) — or load existing from localStorage
4. Fund FPC (bridge iframe with `?recipients=adminAddr,ephAmount;fpcAddr,amount`)
5. Done → enter dashboard

On reload: if FPC address in localStorage → skip setup, go straight to dashboard.

### Dashboard phase (tabbed)
- **Apps** tab: sign up + registered apps list
- **Pricing** tab: network fees, cost calculator, margin visualizer

## Fee Pricing Service

New file: `src/services/fee-pricing.ts`

Port from clustec's `FeePricingService` (https://github.com/Thunkar/clustec/blob/main/packages/server/src/services/fee-pricing.ts):
- `getEthPerFeeAssetE12()` — reads Rollup L1 contract via viem (`getEthPerFeeAsset` function)
- `getEthUsdPrice()` — CoinGecko API with 5-min cache
- `estimateTxCostUsd(feeRaw)` → `{ costUsd, costEth, costFpa }`
- `getPricing()` → `{ ethUsdPrice, ethPerFeeAssetE12 }`

Also:
```typescript
export async function fetchFeeStats(blocks?: number): Promise<FeeStats>
// Fetches from https://api.clustec.xyz/networks/testnet/fees/stats?blocks=N
```

The rollup address comes from `nodeInfo.l1ContractAddresses.rollupAddress` — exposed from `WalletContext`.

Use `@aztec/l1-artifacts` for `RollupAbi` (add to deps).

## Pricing Tab component

`src/components/PricingTab.tsx` — three sections:

### Network Fee Stats (auto-fetched from clustec API)
- Block range, tx count
- Actual fee: min / median / p75 / max (displayed in FJ + USD)
- Current base fee L2
- Refreshes every 60s

### Cost Calculator (interactive)
- Inputs: Max fee per tx (FJ), Uses per subscription, Number of users
- Live outputs:
  - Per-tx max cost: X FJ ($Y)
  - Per-subscription cost: X FJ × uses = Z FJ ($W)
  - Total package cost: Z FJ × users = T FJ ($P)
  - Headroom bar: visual `[network P75 ████░░░░ max fee]`
  - Warning if maxFee < P75

### Package Summary Card
- "To sponsor **N users × M uses** at **X FJ** max fee → app developer pays **$Z USD**"

## AppSignUp changes

- "Max Fee" field: labeled "Max Fee (FJ)", input in human-readable FJ (e.g. "2.5")
- Helper text shows USD equivalent (live, from pricing service)
- Below: "Network P75: X FJ ($Y)" for context
- Remove all "wei" references

## WalletContext updates

Expose additional fields:
- `rollupAddress: string | null` — from `nodeInfo.l1ContractAddresses.rollupAddress`
- `l1ChainId: number | null` — from `nodeInfo.l1ChainId`
- `l1RpcUrl: string | null` — from `activeNetwork.l1RpcUrl`

## Dependencies to add

- `viem` — for L1 contract reads
- `@aztec/l1-artifacts` — for RollupAbi

## Files to create/modify

| File | Action |
|------|--------|
| `src/services/fee-pricing.ts` | **New** — FeePricingService port from clustec |
| `src/components/SetupWizard.tsx` | **New** — linear setup (fund admin → deploy → fund FPC) |
| `src/components/PricingTab.tsx` | **New** — fee stats + cost calculator + visual |
| `src/components/Dashboard.tsx` | **New** — tabbed (Apps + Pricing) |
| `src/App.tsx` | **Rewrite** — setup → dashboard |
| `src/components/AppSignUp.tsx` | FJ units, USD context, remove wei |
| `src/contexts/WalletContext.tsx` | Expose rollupAddress, l1ChainId, l1RpcUrl |
| `src/components/FPCDeploy.tsx` | **Delete** — absorbed into SetupWizard |
| `package.json` | Add viem, @aztec/l1-artifacts |

## Implementation Order

1. Add `viem` + `@aztec/l1-artifacts` deps
2. Create `fee-pricing.ts` service (ported from clustec + clustec API stats)
3. Update `WalletContext` to expose `rollupAddress`, `l1ChainId`, `l1RpcUrl`
4. Create `SetupWizard.tsx` (absorb FPCDeploy logic)
5. Create `PricingTab.tsx` (fee stats + calculator + visual)
6. Create `Dashboard.tsx` (tabs: Apps + Pricing)
7. Rewrite `App.tsx` (setup → dashboard flow)
8. Update `AppSignUp.tsx` (FJ units, USD context, remove wei)
9. Delete `FPCDeploy.tsx`
