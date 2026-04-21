/**
 * Deploys the GregoJuiceBridge L1 contract against the local-network's
 * embedded Anvil instance and returns its deterministic address.
 *
 * Uses the CREATE2 helper from `@gregojuice/ethereum` — same path prod uses —
 * so the address is a pure function of bytecode + salt. The Anvil dev
 * private key (account #0) is hard-coded; it's a test key, not a secret.
 */
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { deployBridge } from "@gregojuice/ethereum";

/** Anvil's deterministic account #0 — NOT A SECRET. */
const ANVIL_DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function deployL1BridgeContract(l1RpcUrl: string): Promise<string> {
  return deployBridge({
    rpcUrl: l1RpcUrl,
    account: privateKeyToAccount(ANVIL_DEV_KEY),
    chain: foundry,
  });
}
