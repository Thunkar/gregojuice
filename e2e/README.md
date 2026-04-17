# E2E Tests

Scaffolding for end-to-end tests across all apps (`swap`, `bridge`, `fpc-operator`).

## Status

- Network lifecycle (`fixtures/local-network.ts`): scaffolded — spawns `aztec start --local-network`, waits for Anvil (L1) + Aztec node (L2) to be ready, tears down at end of run.
- Deploy lifecycle (`fixtures/deploy.ts`): stub — not implemented. Will run each app's deploy script against the network and write addresses into `apps/<app>/.e2e/local.json`.
- Test flows: only smoke tests (`<app>.smoke.spec.ts`) that assert the app boots. Real onboarding + per-app flows come next.

## Running locally

```sh
# From repo root
yarn build             # build workspace packages (aztec, ethereum, ...)
yarn workspace @gregojuice/e2e test
```

The config starts a dev server per app (swap:5175, bridge:5173, fpc-operator:5174) and runs matching specs against each. Local-network lifecycle is owned by Playwright's `globalSetup`/`globalTeardown`.

Skip the network startup during local iteration (e.g. when you already have `aztec start --local-network` running in another terminal):

```sh
GJ_E2E_SKIP_NETWORK=1 yarn workspace @gregojuice/e2e test
```

## CI

Wired into `.github/workflows/e2e.yml`. Same job installs the pinned Aztec CLI used by `deploy.yml`, then runs the full build + e2e matrix. Playwright HTML report is uploaded on failure.
