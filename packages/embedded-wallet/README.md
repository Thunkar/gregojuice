# @gregojuice/embedded-wallet

Embeddable Aztec wallet backed by `SchnorrInitializerlessAccount`. Thin layer on top of `@aztec/wallets` that ships pre-wired React components + hooks for dApps.

## Subpath exports

| Import                           | Contents                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@gregojuice/embedded-wallet`    | Core wallet logic: `createSchnorrInitializerlessAccount`, `deployWithImmutables`, `computeContractSalt`, capsule helpers. No React. |
| `@gregojuice/embedded-wallet/ui` | React components + hooks: `EmbeddedWalletProvider`, `useEmbeddedWallet`, connect button, onboarding modal.                          |

## Why "initializerless"?

The account contract has no `initialize` entrypoint. The signing public key is passed via a capsule on every call and its hash is baked into the contract salt, so the contract's address commits to the key without requiring a deploy-time init tx. Deploy and the first send can land in the same tx.

Helpers you'll actually use:

```ts
import {
  createSchnorrInitializerlessAccount, // secretKey → { signingKey, signingPublicKey, actualSalt }
  computeImmutablesAddress, // predict address without touching a wallet
  deployWithImmutables, // register + deploy through an EmbeddedWallet
  createSigningKeyCapsule, // build the capsule every call needs
} from "@gregojuice/embedded-wallet";
```

## Testing

```bash
yarn workspace @gregojuice/embedded-wallet test
```

Uses the in-process `setupLocalNetwork` fixture from `@gregojuice/common/testing` — no external `aztec start --local-network` needed.
