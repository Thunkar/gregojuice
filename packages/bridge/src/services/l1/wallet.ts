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
