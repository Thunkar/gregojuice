# @aztec-kit/contracts-ethereum

L1 bridge Solidity contract + deterministic deployment helpers.

## What's here

- `solidity/src/GoBridge.sol` — L1 bridge contract. `depositToAztecPublic` accepts FJ + emits the L1→L2 message picked up by the Aztec rollup. Used by `@aztec-kit/bridge` and by `@aztec-kit/common/bridging`.
- `lib/deterministic.ts` — CREATE2 deploy helper. Computes the bridge address from `(deployer, salt, bytecode)` so every network lands on the same address on a fresh chain.

## Build

```bash
yarn workspace @aztec-kit/contracts-ethereum build   # forge compile + codegen TS artifacts
```

The build writes Solidity artifacts to `solidity/out/` (via forge) and typed bytecode/ABI to `generated/bridge-contract-artifacts.ts`.

## Dev

Forge + anvil required. `anvil` is installed as part of the `aztec` CLI install via the `~/.foundry` tree; `yarn setup:local` relies on it.
