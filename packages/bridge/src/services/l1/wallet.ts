import type { Hex } from "viem";

export async function switchChain(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet found");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (err: unknown) {
    const error = err as { code?: number };
    if (error.code === 4902) {
      throw new Error(
        `Chain ${chainId} not configured in your wallet. Please add it manually.`,
      );
    }
    throw err;
  }
}

export async function getConnectedAccount(): Promise<Hex | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({
      method: "eth_accounts",
    })) as Hex[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(): Promise<Hex> {
  if (!window.ethereum)
    throw new Error("No EVM wallet found. Please install MetaMask.");
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as Hex[];
  if (!accounts[0]) throw new Error("No account returned");
  return accounts[0];
}

/** Returns the wallet's current chain ID, or null if unavailable. */
export async function getWalletChainId(): Promise<number | null> {
  if (!window.ethereum) return null;
  try {
    const chainIdHex = (await window.ethereum.request({
      method: "eth_chainId",
    })) as string;
    return parseInt(chainIdHex, 16);
  } catch {
    return null;
  }
}

/**
 * Opens the wallet's account picker so the user can switch accounts.
 * Returns the newly selected account address.
 */
export async function requestAccountSwitch(): Promise<Hex> {
  if (!window.ethereum) throw new Error("No EVM wallet found");
  const permissions = (await window.ethereum.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {} }],
  })) as Array<{ caveats?: Array<{ value: string[] }> }>;
  // After permission grant, read accounts to get the selected one
  const accounts = (await window.ethereum.request({
    method: "eth_accounts",
  })) as Hex[];
  if (!accounts[0]) throw new Error("No account selected");
  return accounts[0];
}

/**
 * Revokes the wallet connection permission (MetaMask EIP-2255).
 * Falls back to a no-op on wallets that don't support it.
 */
export async function revokeWalletPermissions(): Promise<void> {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Not all wallets support revokePermissions — clearing local state is enough
  }
}
