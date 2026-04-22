# @gregojuice/aztec

Noir contracts for the gregojuice ecosystem + generated TypeScript artifacts + a handful of TS helpers.

## Contracts

| Contract | Purpose |
|---|---|
| `Token` | Standard Aztec token with private + public balances. Used for GregoCoin (GRG), GregoCoinPremium (GRGP), LiquidityToken (LQT). |
| `AMM` | Uniswap-v2-style constant-product AMM over two Token contracts. Mints LiquidityToken shares. |
| `ProofOfPassword` | Faucet gated by a password hash. `check_password_and_mint` mints GRG to the caller if the password hashes to the stored value. |
| `SubscriptionFPC` | Fee Payment Contract. Admin pre-registers `(contract, function)` tuples with a `maxFee`; users "subscribe" and the FPC pays their gas. |
| `SchnorrInitializerlessAccount` | Schnorr account with no `initialize` entrypoint. Signing key comes from a capsule on every call. |
| `EcdsaAccountDeployer` | ECDSA-signer variant. |

## TS exports

```ts
import { SubscriptionFPC } from "@gregojuice/aztec/subscription-fpc";
import { FPC_GAS_CONSTANTS } from "@gregojuice/aztec/fpc-gas-constants";
import { TokenContract, TokenContractArtifact } from "@gregojuice/aztec/artifacts/Token";
// … any artifact under noir/artifacts/* is reachable via /artifacts/<Name>
```

## Build

```bash
yarn workspace @gregojuice/aztec build     # compile noir + codegen TS + tsc
yarn workspace @gregojuice/aztec test      # vitest — integration tests using the in-process local-network fixture
```

The `build` step runs `aztec compile` inside `noir/` and then `aztec codegen` into `noir/artifacts/`. Regenerated TS artifacts are gitignored; CI rebuilds them on demand.

## Layout

```
noir/               # .nr sources + Nargo.toml workspace
noir/artifacts/     # generated TS — gitignored
lib/                # hand-written TS helpers (SubscriptionFPC wrapper, gas constants)
tests/              # vitest integration tests
```
