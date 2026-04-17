# GregoSwap

A decentralized token swap application built on the Aztec blockchain featuring private token swaps and a proof-of-password token faucet.

## Features

- **Private Token Swaps**: Swap between GregoCoin (GRG) and GregoCoinPremium (GRGP) using an Automated Market Maker (AMM)
- **Token Faucet**: Claim free GregoCoin tokens using a proof-of-password mechanism
- **Wallet Integration**: Connect with Aztec wallet extensions or use an embedded wallet
- **Multi-Flow Onboarding**: Seamless onboarding experience that adapts based on user's token balance

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 22 or higher
- **Yarn**: Version 4.5.2 (via Corepack)
- **Aztec CLI**: Required for compiling contracts and running local sandbox

## Installation

### 1. Install Dependencies

```bash
yarn install
```

### 2. Install Aztec CLI

```bash
VERSION=4.0.0-nightly.20260205 bash -i <(curl -sL https://install.aztec.network/4.0.0-nightly.20260205/)
```

### 3. Set Aztec Version

The project uses Aztec version `v4.0.0-devnet.2-patch.3`. Set it using:

```bash
aztec-up install 4.0.0-nightly.20260205
```

## Updating to Latest Nightly

```bash
node scripts/update.js                                        # auto-detect latest
node scripts/update.js --version 4.0.0-nightly.20260206       # specific version
PASSWORD=<pw> node scripts/update.js --deploy                  # update + deploy to nextnet
PASSWORD=<pw> node scripts/update.js --deploy devnet           # update + deploy to devnet
```

Use `--deploy [local|devnet|nextnet]` to deploy after update (default: `nextnet`). Use `--skip-aztec-up` to skip Aztec CLI installation. In CI (`CI=1`), the script installs Aztec via curl instead of aztec-up.

## Development Setup

### Running Locally with Aztec Sandbox

#### 1. Start the Aztec Sandbox

In a separate terminal, start the local Aztec sandbox:

```bash
aztec start --local-network
```

This will start a local Aztec node on `http://localhost:8080`.

**Note**: Keep this terminal running while developing. The local node must be running for contract deployment and local testing.

#### 2. Compile Contracts

In your main terminal, compile the smart contracts:

```bash
yarn compile:contracts
```

This will:

- Compile the Noir contracts in the `contracts/` directory
- Generate TypeScript bindings for contract interaction
- Output compiled artifacts to `contracts/target/`

#### 3. Deploy Contracts Locally

Set a password for the proof-of-password contract and deploy:

```bash
PASSWORD=your-secret-password PROVER_ENABLED=false yarn deploy:local
```

**Important**: Remember this password! You'll need it to claim tokens through the faucet.

This will:

- Deploy GregoCoin and GregoCoinPremium token contracts
- Deploy the AMM (Automated Market Maker) contract
- Deploy the ProofOfPassword contract
- Generate a `deployed-addresses.json` file with contract addresses

#### 4. Deploy the Subscription FPC

GregoSwap uses a [SubscriptionFPC](https://github.com/Thunkar/gregojuice) (Fee Payment
Contract) to sponsor user transactions: the drip, the swap, and the offchain send all
run for free from the user's perspective, with the FPC paying gas in Fee Juice.

If you are testing on a local network, you will need to bootstrap FPC infrastructure.

After the base contracts are in place, you can deploy and configure the FPC with:

```bash
yarn deploy:fpc:local
```

This single command does everything needed to bring the FPC online against the local
sandbox:

- Deploys a fresh `SubscriptionFPC` with generated keys
- Bridges fee juice from L1 (Anvil) to the FPC's L2 address so it can actually pay gas
- Calls `sign_up` on the FPC for each sponsored function declared in
  `scripts/deploy-subscription-fpc.ts` (currently: `PoP.check_password_and_mint`,
  `AMM.swap_tokens_for_exact_tokens_from`, and
  `Token.transfer_in_private_deliver_offchain` on both token contracts)
- Claims the L1→L2 message on behalf of the FPC so its balance is usable
- Writes the FPC address, secret key, and function-selector map into
  `src/config/networks/local.json` under `subscriptionFPC`

The script is idempotent over the underlying config: re-running it deploys a new FPC
and overwrites the `subscriptionFPC` block. You can use a different config file via
`NETWORK_CONFIG_PATH`.

Note this is not needed to test on Testnet's or Mainnet's, since there the SubscriptionFPC infrastructure is already set up.

#### 5. Start the Development Server

```bash
yarn dev
```
