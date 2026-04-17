import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
  formatUnits,
  type Chain,
  type TransactionReceipt,
  parseAbi,
  decodeEventLog,
} from "viem";
import { sepolia, mainnet, foundry } from "viem/chains";
import { computeSecretHash } from "@aztec/aztec.js/crypto";
import { Fr } from "@aztec/foundation/curves/bn254";
import { BRIDGE_CONTRACT_ABI, BRIDGE_CONTRACT_BYTECODE } from "@gregojuice/ethereum";
import { BRIDGE_CONTRACT_STORAGE_KEY } from "../../components/wizard/constants";

// ── ABIs ─────────────────────────────────────────────────────────────

export const erc20ReadAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const erc20WriteAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const handlerReadAbi = parseAbi(["function mintAmount() view returns (uint256)"]);

// ── Chain helpers ────────────────────────────────────────────────────

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  1: mainnet,
  31337: foundry,
};

export function getChain(chainId: number): Chain {
  return CHAIN_MAP[chainId] ?? { ...sepolia, id: chainId, name: `Chain ${chainId}` };
}

// ── Hex helpers ──────────────────────────────────────────────────────

/** Converts a bigint to a 0x-prefixed, 64-char hex string. */
export function toHex64(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

// ── Viem workaround ──────────────────────────────────────────────────

// Workaround: viem 2.47 requires authorizationList in readContract types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const viemReadContract = (client: any, params: any) => client.readContract(params);

// ── Client factories ─────────────────────────────────────────────────

/**
 * Creates a public client that reads through the user's wallet provider (e.g. MetaMask)
 * if available, falling back to the configured RPC URL.
 */
export function getL1PublicClient(l1RpcUrl: string, chainId: number) {
  const chain = getChain(chainId);
  if (window.ethereum) {
    return createPublicClient({ chain, transport: custom(window.ethereum) });
  }
  return createPublicClient({ chain, transport: http(l1RpcUrl) });
}

/**
 * Returns a { publicClient, walletClient, account, chain } bundle for L1 write operations.
 * Throws if no EVM wallet is available or no account is connected.
 */
export async function getL1Clients(chainId: number) {
  if (!window.ethereum) throw new Error("No EVM wallet found");
  const chain = getChain(chainId);
  const publicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");
  return { publicClient, walletClient, account, chain };
}

// ── ERC20 read helpers ───────────────────────────────────────────────

export async function getFeeJuiceBalance(
  l1RpcUrl: string,
  chainId: number,
  tokenAddress: Hex,
  account: Hex,
): Promise<{ balance: bigint; formatted: string; decimals: number }> {
  const client = getL1PublicClient(l1RpcUrl, chainId);
  const [balance, decimals] = await Promise.all([
    viemReadContract(client, {
      address: tokenAddress,
      abi: erc20ReadAbi,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>,
    viemReadContract(client, {
      address: tokenAddress,
      abi: erc20ReadAbi,
      functionName: "decimals",
    }) as Promise<number>,
  ]);
  return { balance, formatted: formatUnits(balance, decimals), decimals };
}

export async function getMintAmount(
  l1RpcUrl: string,
  chainId: number,
  handlerAddress: Hex,
): Promise<bigint> {
  const client = getL1PublicClient(l1RpcUrl, chainId);
  return viemReadContract(client, {
    address: handlerAddress,
    abi: handlerReadAbi,
    functionName: "mintAmount",
  }) as Promise<bigint>;
}

// ── Claim secret generation ──────────────────────────────────────────

export async function generateClaimSecret(): Promise<{
  secret: bigint;
  secretHash: bigint;
}> {
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  return { secret: secret.toBigInt(), secretHash: secretHash.toBigInt() };
}

// ── Event extraction ─────────────────────────────────────────────────

const depositEventAbi = parseAbi([
  "event DepositToAztecPublic(bytes32 indexed to, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index)",
]);

type DepositEvent = {
  to: Hex;
  amount: bigint;
  secretHash: Hex;
  key: Hex;
  index: bigint;
};

export type { DepositEvent };

export function extractAllDepositEvents(receipt: TransactionReceipt): DepositEvent[] {
  const events: DepositEvent[] = [];
  for (const log of receipt.logs) {
    try {
      const raw = log as unknown as { data: Hex; topics: [Hex, ...Hex[]] };
      if (!raw.topics?.[0]) continue;
      const decoded = decodeEventLog({
        abi: depositEventAbi,
        data: raw.data,
        topics: raw.topics,
      }) as { args: DepositEvent };
      events.push(decoded.args);
    } catch {
      // Not a DepositToAztecPublic event — skip
    }
  }
  return events;
}

// ── Bridge contract deployment ───────────────────────────────────────

/** In-flight deployment promise to prevent double-deploy from concurrent calls. */
let deploymentInFlight: Promise<Hex> | null = null;

/**
 * Returns the GregoJuiceBridge contract address.
 *
 * Resolution order:
 * 1. VITE_BRIDGE_CONTRACT_ADDRESS env var (baked in at build time — production)
 * 2. localStorage cache keyed by chain ID (persists across sessions)
 * 3. Auto-deploy on the fly (dev/first-use fallback — user pays deployment gas)
 */
export async function deployOrGetBridgeContract(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: Hex,
  chain: Chain,
): Promise<Hex> {
  // 1. Check build-time env var
  const envAddr = import.meta.env.VITE_BRIDGE_CONTRACT_ADDRESS as string | undefined;
  if (envAddr) {
    return envAddr as Hex;
  }

  // 2. Check localStorage cache (and clean up orphaned v1 key)
  const storageKey = `${BRIDGE_CONTRACT_STORAGE_KEY}_${chain.id}`;
  try {
    localStorage.removeItem(`gregojuice_bridge_contract_${chain.id}`);
  } catch {
    /* v1 cleanup */
  }
  const cached = localStorage.getItem(storageKey);
  if (cached) {
    const code = await publicClient.getCode({ address: cached as Hex });
    if (code && code !== "0x") return cached as Hex;
  }

  // 3. Auto-deploy (with concurrency guard)
  if (deploymentInFlight) return deploymentInFlight;

  deploymentInFlight = (async () => {
    const hash = await walletClient.deployContract({
      abi: BRIDGE_CONTRACT_ABI,
      bytecode: BRIDGE_CONTRACT_BYTECODE,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Bridge contract deployment failed");

    localStorage.setItem(storageKey, receipt.contractAddress);
    return receipt.contractAddress as Hex;
  })().finally(() => {
    deploymentInFlight = null;
  });

  return deploymentInFlight;
}
