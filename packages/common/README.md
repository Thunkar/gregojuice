# @gregojuice/common

Shared building blocks used by every app + every script in the monorepo. Organised by domain — no cross-domain barrel.

## Subpath exports

| Import                        | Contents                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@gregojuice/common/ui`       | `shortAddress`, `NetworkSwitcher`, `createNetworkContext`. React + MUI. Used by all three app UIs.                                                    |
| `@gregojuice/common/bridging` | `bridge`, `bridgeAndClaim` — the L1→L2 fee-juice flows. Low-level primitives live in `./bridging/utils.ts` if you need them. Node-only.               |
| `@gregojuice/common/fees`     | `fetchFeeStats`, `computeMaxFeeFromP75` — calibrate `maxFee` from the clustec public fee API.                                                         |
| `@gregojuice/common/testing`  | Deploy-script plumbing: network config, CLI arg parsing, wallet setup, admin account helpers, `setupLocalNetwork` in-process test fixture. Node-only. |
| `@gregojuice/common/vite`     | `aztecVitePlugin` (drop-in, Vite-version-aware) + `chunkSizeValidator`. See `vite` section below.                                                     |

## `testing` — highlights

```ts
import {
  parseNetwork, // reads --network from argv
  setupWallet, // EmbeddedWallet + SponsoredFPC registered
  loadOrCreateSecret, // env-var-backed Fr secret
  getAdmin, // strict — throws if admin not on-chain
  setupLocalNetwork, // full in-process anvil + Aztec node
} from "@gregojuice/common/testing";
```

`setupLocalNetwork({ fundedAddresses })` spawns a fresh anvil on a random port, deploys the L1 contracts, starts an `AztecNodeService`, and pre-funds the given addresses at genesis. Each caller gets its own sandbox — suites can run in parallel.

Used by:

- `packages/contracts/aztec/tests/utils.ts` — integration tests
- `packages/embedded-wallet/tests/*.test.ts` — integration tests

## `vite`

```ts
import { aztecVitePlugin } from "@gregojuice/common/vite";

export default defineConfig({
  plugins: [aztecVitePlugin(), /* react(), etc. */],
});
```

Sets cross-origin isolation headers, node polyfills (`buffer`, `path`) with the yarn-workspace absolute-path fix, and the build/source targets. On Vite ≤7 it also adds the `optimizeDeps.exclude` list (bb.js, noir wasm packages, sqlite-wasm, kv-store sqlite-opfs), the matching CJS `include` list (pino, util, sha3, lodash.*), and a `.wasm` content-type middleware — all needed because Vite 7's esbuild pre-bundler mis-handles Web Workers and sibling `.wasm` assets. Vite 8's Rolldown pre-bundler handles those correctly, so none of the extras are applied there.

`{ es2016: true }` lowers `build.target` / `oxc.target` (or `esbuild.target` on Vite ≤7) so native `async function`s get transpiled to Promise chains. Set this in dev if you use zone.js — V8's "fast await" otherwise bypasses `Promise.prototype.then` hooks.
