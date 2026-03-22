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
} from "viem";
import { sepolia, mainnet, foundry } from "viem/chains";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { computeSecretHash } from "@aztec/aztec.js/crypto";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";

// ── ABIs (separate read vs write to avoid viem authorizationList issues) ──

const erc20ReadAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const erc20WriteAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const portalWriteAbi = parseAbi([
  "function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) returns (bytes32, uint256)",
]);

const handlerReadAbi = parseAbi([
  "function mintAmount() view returns (uint256)",
]);

const handlerWriteAbi = parseAbi(["function mint(address _recipient)"]);

const bridgeContractAbi = parseAbi([
  "function mintAndBridgeDouble(address feeAssetHandler, address feeJuice, address portal, bytes32 toSmall, uint256 amountSmall, bytes32 secretHashSmall, bytes32 toLarge, uint256 amountLarge, bytes32 secretHashLarge)",
  "function bridgeDouble(address feeJuice, address portal, bytes32 toSmall, uint256 amountSmall, bytes32 secretHashSmall, bytes32 toLarge, uint256 amountLarge, bytes32 secretHashLarge)",
  "function mintAndBridge(address feeAssetHandler, address feeJuice, address portal, bytes32 to, uint256 amount, bytes32 secretHash)",
  "function bridge(address feeJuice, address portal, bytes32 to, uint256 amount, bytes32 secretHash)",
]);

const BRIDGE_CONTRACT_BYTECODE =
  "0x6080604052348015600e575f5ffd5b50610f3b8061001c5f395ff3fe608060405234801561000f575f5ffd5b506004361061004a575f3560e01c80635ef2929e1461004e57806362c17ce31461006a57806394071cd614610086578063d8cc2d2e146100a2575b5f5ffd5b610068600480360381019061006391906109d8565b6100be565b005b610084600480360381019061007f9190610a9c565b61036a565b005b6100a0600480360381019061009b9190610b13565b6104e9565b005b6100bc60048036038101906100b79190610b9c565b610704565b005b5f82866100cb9190610c7a565b90505f8a73ffffffffffffffffffffffffffffffffffffffff16635a2bcc186040518163ffffffff1660e01b8152600401602060405180830381865afa158015610117573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061013b9190610cc1565b90505f816001838561014d9190610c7a565b6101579190610cec565b6101619190610d4c565b90505f5f90505b818110156101e3578c73ffffffffffffffffffffffffffffffffffffffff16636a627842306040518263ffffffff1660e01b81526004016101a99190610d8b565b5f604051808303815f87803b1580156101c0575f5ffd5b505af11580156101d2573d5f5f3e3d5ffd5b505050508080600101915050610168565b508a73ffffffffffffffffffffffffffffffffffffffff1663095ea7b38b856040518363ffffffff1660e01b815260040161021f929190610db3565b6020604051808303815f875af115801561023b573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061025f9190610e0f565b508973ffffffffffffffffffffffffffffffffffffffff1663284b5dc68a8a8a6040518463ffffffff1660e01b815260040161029d93929190610e49565b60408051808303815f875af11580156102b8573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906102dc9190610e92565b50508973ffffffffffffffffffffffffffffffffffffffff1663284b5dc68787876040518463ffffffff1660e01b815260040161031b93929190610e49565b60408051808303815f875af1158015610336573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061035a9190610e92565b5050505050505050505050505050565b8473ffffffffffffffffffffffffffffffffffffffff166323b872dd3330856040518463ffffffff1660e01b81526004016103a793929190610ed0565b6020604051808303815f875af11580156103c3573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906103e79190610e0f565b508473ffffffffffffffffffffffffffffffffffffffff1663095ea7b385846040518363ffffffff1660e01b8152600401610423929190610db3565b6020604051808303815f875af115801561043f573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906104639190610e0f565b508373ffffffffffffffffffffffffffffffffffffffff1663284b5dc68484846040518463ffffffff1660e01b81526004016104a193929190610e49565b60408051808303815f875af11580156104bc573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906104e09190610e92565b50505050505050565b5f8673ffffffffffffffffffffffffffffffffffffffff16635a2bcc186040518163ffffffff1660e01b8152600401602060405180830381865afa158015610533573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906105579190610cc1565b90505f81600183866105699190610c7a565b6105739190610cec565b61057d9190610d4c565b90505f5f90505b818110156105ff578873ffffffffffffffffffffffffffffffffffffffff16636a627842306040518263ffffffff1660e01b81526004016105c59190610d8b565b5f604051808303815f87803b1580156105dc575f5ffd5b505af11580156105ee573d5f5f3e3d5ffd5b505050508080600101915050610584565b508673ffffffffffffffffffffffffffffffffffffffff1663095ea7b387866040518363ffffffff1660e01b815260040161063b929190610db3565b6020604051808303815f875af1158015610657573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061067b9190610e0f565b508573ffffffffffffffffffffffffffffffffffffffff1663284b5dc68686866040518463ffffffff1660e01b81526004016106b993929190610e49565b60408051808303815f875af11580156106d4573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906106f89190610e92565b50505050505050505050565b5f82866107119190610c7a565b90508873ffffffffffffffffffffffffffffffffffffffff166323b872dd3330846040518463ffffffff1660e01b815260040161075093929190610ed0565b6020604051808303815f875af115801561076c573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906107909190610e0f565b508873ffffffffffffffffffffffffffffffffffffffff1663095ea7b389836040518363ffffffff1660e01b81526004016107cc929190610db3565b6020604051808303815f875af11580156107e8573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061080c9190610e0f565b508773ffffffffffffffffffffffffffffffffffffffff1663284b5dc68888886040518463ffffffff1660e01b815260040161084a93929190610e49565b60408051808303815f875af1158015610865573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906108899190610e92565b50508773ffffffffffffffffffffffffffffffffffffffff1663284b5dc68585856040518463ffffffff1660e01b81526004016108c893929190610e49565b60408051808303815f875af11580156108e3573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906109079190610e92565b5050505050505050505050565b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f61094182610918565b9050919050565b61095181610937565b811461095b575f5ffd5b50565b5f8135905061096c81610948565b92915050565b5f819050919050565b61098481610972565b811461098e575f5ffd5b50565b5f8135905061099f8161097b565b92915050565b5f819050919050565b6109b7816109a5565b81146109c1575f5ffd5b50565b5f813590506109d2816109ae565b92915050565b5f5f5f5f5f5f5f5f5f6101208a8c0312156109f6576109f5610914565b5b5f610a038c828d0161095e565b9950506020610a148c828d0161095e565b9850506040610a258c828d0161095e565b9750506060610a368c828d01610991565b9650506080610a478c828d016109c4565b95505060a0610a588c828d01610991565b94505060c0610a698c828d01610991565b93505060e0610a7a8c828d016109c4565b925050610100610a8c8c828d01610991565b9150509295985092959850929598565b5f5f5f5f5f60a08688031215610ab557610ab4610914565b5b5f610ac28882890161095e565b9550506020610ad38882890161095e565b9450506040610ae488828901610991565b9350506060610af5888289016109c4565b9250506080610b0688828901610991565b9150509295509295909350565b5f5f5f5f5f5f60c08789031215610b2d57610b2c610914565b5b5f610b3a89828a0161095e565b9650506020610b4b89828a0161095e565b9550506040610b5c89828a0161095e565b9450506060610b6d89828a01610991565b9350506080610b7e89828a016109c4565b92505060a0610b8f89828a01610991565b9150509295509295509295565b5f5f5f5f5f5f5f5f610100898b031215610bb957610bb8610914565b5b5f610bc68b828c0161095e565b9850506020610bd78b828c0161095e565b9750506040610be88b828c01610991565b9650506060610bf98b828c016109c4565b9550506080610c0a8b828c01610991565b94505060a0610c1b8b828c01610991565b93505060c0610c2c8b828c016109c4565b92505060e0610c3d8b828c01610991565b9150509295985092959890939650565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f610c84826109a5565b9150610c8f836109a5565b9250828201905080821115610ca757610ca6610c4d565b5b92915050565b5f81519050610cbb816109ae565b92915050565b5f60208284031215610cd657610cd5610914565b5b5f610ce384828501610cad565b91505092915050565b5f610cf6826109a5565b9150610d01836109a5565b9250828203905081811115610d1957610d18610c4d565b5b92915050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601260045260245ffd5b5f610d56826109a5565b9150610d61836109a5565b925082610d7157610d70610d1f565b5b828204905092915050565b610d8581610937565b82525050565b5f602082019050610d9e5f830184610d7c565b92915050565b610dad816109a5565b82525050565b5f604082019050610dc65f830185610d7c565b610dd36020830184610da4565b9392505050565b5f8115159050919050565b610dee81610dda565b8114610df8575f5ffd5b50565b5f81519050610e0981610de5565b92915050565b5f60208284031215610e2457610e23610914565b5b5f610e3184828501610dfb565b91505092915050565b610e4381610972565b82525050565b5f606082019050610e5c5f830186610e3a565b610e696020830185610da4565b610e766040830184610e3a565b949350505050565b5f81519050610e8c8161097b565b92915050565b5f5f60408385031215610ea857610ea7610914565b5b5f610eb585828601610e7e565b9250506020610ec685828601610cad565b9150509250929050565b5f606082019050610ee35f830186610d7c565b610ef06020830185610d7c565b610efd6040830184610da4565b94935050505056fea264697066735822122081ae1845bc28d0b248f1e36e967ccb2aa7285b87acf2bb36164117e0b059a75264736f6c634300081e0033" as Hex;

const BRIDGE_CONTRACT_STORAGE_KEY = "gregojuice_bridge_contract";

// ── Types ────────────────────────────────────────────────────────────

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  1: mainnet,
  31337: foundry,
};

function getChain(chainId: number): Chain {
  return (
    CHAIN_MAP[chainId] ?? { ...sepolia, id: chainId, name: `Chain ${chainId}` }
  );
}

export interface L1Addresses {
  feeJuicePortal: Hex;
  feeJuice: Hex;
  feeAssetHandler: Hex | null;
}

export interface ClaimCredentials {
  claimSecret: string;
  claimSecretHash: string;
  messageHash: string;
  messageLeafIndex: string;
  claimAmount: string;
  recipient: string;
}

export type BridgeStep =
  | "idle"
  | "fetching-addresses"
  | "minting"
  | "approving"
  | "bridging"
  | "waiting-confirmation"
  | "waiting-l2-sync"
  | "claimable"
  | "done"
  | "error";

// ── Aztec Node Client ────────────────────────────────────────────────

let cachedNode: { url: string; client: AztecNode } | null = null;

export function getAztecNode(aztecNodeUrl: string): AztecNode {
  if (cachedNode && cachedNode.url === aztecNodeUrl) return cachedNode.client;
  const client = createAztecNodeClient(aztecNodeUrl);
  cachedNode = { url: aztecNodeUrl, client };
  return client;
}

export async function fetchL1Addresses(
  aztecNodeUrl: string,
): Promise<L1Addresses & { l1ChainId: number }> {
  const node = getAztecNode(aztecNodeUrl);
  const nodeInfo = await node.getNodeInfo();
  const addrs = nodeInfo.l1ContractAddresses;

  const rawHandler = (addrs as Record<string, unknown>).feeAssetHandlerAddress;
  const handlerStr =
    rawHandler && typeof rawHandler === "object" && "toString" in rawHandler
      ? (rawHandler as { toString(): string }).toString()
      : typeof rawHandler === "string"
        ? rawHandler
        : null;
  const isZero =
    !handlerStr || handlerStr === "0x0000000000000000000000000000000000000000";

  return {
    feeJuicePortal: addrs.feeJuicePortalAddress.toString() as Hex,
    feeJuice: addrs.feeJuiceAddress.toString() as Hex,
    feeAssetHandler: isZero ? null : (handlerStr as Hex),
    l1ChainId: nodeInfo.l1ChainId,
  };
}

// ── L1->L2 Message Readiness ─────────────────────────────────────────

export type MessageStatus = "pending" | "ready" | "error";

/**
 * Polls the Aztec node to check if the L1->L2 message is ready to claim.
 * Calls onStatus with updates. Returns when ready or on error/cancel.
 */
export function pollMessageReadiness(
  aztecNodeUrl: string,
  messageHash: string,
  onStatus: (status: MessageStatus) => void,
): { cancel: () => void } {
  let cancelled = false;

  const poll = async () => {
    const node = getAztecNode(aztecNodeUrl);
    const msgHash = Fr.fromHexString(messageHash);

    while (!cancelled) {
      try {
        const ready = await isL1ToL2MessageReady(node, msgHash);
        if (ready) {
          onStatus("ready");
          return;
        }
      } catch {
        // Node may not have seen the message yet - keep polling
      }
      // Wait 5 seconds between polls
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  };

  onStatus("pending");
  poll().catch(() => {
    if (!cancelled) onStatus("error");
  });

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

// ── Claim secret generation ──────────────────────────────────────────

async function generateClaimSecret(): Promise<{
  secret: bigint;
  secretHash: bigint;
}> {
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  return { secret: secret.toBigInt(), secretHash: secretHash.toBigInt() };
}

// ── Read helpers ─────────────────────────────────────────────────────

// Workaround: viem 2.47 requires authorizationList in readContract types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const viemReadContract = (client: any, params: any) =>
  client.readContract(params);

/**
 * Creates a public client that reads through the user's wallet provider (e.g. MetaMask)
 * if available, falling back to the configured RPC URL.
 */
function getL1PublicClient(l1RpcUrl: string, chainId: number) {
  const chain = getChain(chainId);
  if (window.ethereum) {
    return createPublicClient({ chain, transport: custom(window.ethereum) });
  }
  return createPublicClient({ chain, transport: http(l1RpcUrl) });
}

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

// ── Event extraction ─────────────────────────────────────────────────

type DepositEvent = { to: Hex; amount: bigint; secretHash: Hex; key: Hex; index: bigint };

function extractDepositEvent(receipt: TransactionReceipt): DepositEvent {
  const events = extractAllDepositEvents(receipt);
  if (events.length === 0) {
    throw new Error("DepositToAztecPublic event not found in transaction receipt");
  }
  return events[0];
}

function extractAllDepositEvents(receipt: TransactionReceipt): DepositEvent[] {
  const events: DepositEvent[] = [];
  for (const log of receipt.logs) {
    const topics = (log as unknown as { topics: Hex[] }).topics;
    if (!topics || topics.length < 2) continue;

    const data = log.data;
    if (data.length >= 2 + 64 * 4) {
      const amount = BigInt("0x" + data.slice(2, 66));
      const secretHash = ("0x" + data.slice(66, 130)) as Hex;
      const key = ("0x" + data.slice(130, 194)) as Hex;
      const index = BigInt("0x" + data.slice(194, 258));
      const to = topics[1] as Hex;
      events.push({ to, amount, secretHash, key, index });
    }
  }
  return events;
}

// ── Bridge contract deployment ───────────────────────────────────────

/**
 * Returns the GregoJuiceBridge contract address.
 *
 * Resolution order:
 * 1. VITE_BRIDGE_CONTRACT_ADDRESS env var (baked in at build time — production)
 * 2. localStorage cache keyed by chain ID (persists across sessions)
 * 3. Auto-deploy on the fly (dev/first-use fallback — user pays deployment gas)
 */
async function deployOrGetBridgeContract(
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

  // 2. Check localStorage cache
  const storageKey = `${BRIDGE_CONTRACT_STORAGE_KEY}_${chain.id}`;
  const cached = localStorage.getItem(storageKey);
  if (cached) {
    const code = await publicClient.getCode({ address: cached as Hex });
    if (code && code !== "0x") return cached as Hex;
  }

  // 3. Auto-deploy
  const hash = await walletClient.deployContract({
    abi: bridgeContractAbi,
    bytecode: BRIDGE_CONTRACT_BYTECODE,
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("Bridge contract deployment failed");

  localStorage.setItem(storageKey, receipt.contractAddress);
  return receipt.contractAddress;
}

// ── Bridge ───────────────────────────────────────────────────────────

/**
 * Bridges fee juice to an Aztec recipient in a single L1 transaction.
 *
 * With faucet (testnet): 1 MetaMask prompt (contract mints + bridges atomically)
 * Without faucet: 1 approve + 1 bridge = 2 MetaMask prompts
 */
export async function bridgeFeeJuice(params: {
  l1RpcUrl: string;
  chainId: number;
  addresses: L1Addresses;
  aztecRecipient: string;
  amount: bigint;
  mint: boolean;
  onStep: (step: BridgeStep) => void;
}): Promise<ClaimCredentials> {
  const { chainId, addresses, aztecRecipient, amount, mint, onStep } = params;
  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error("No EVM wallet found");
  const publicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");

  const { secret, secretHash } = await generateClaimSecret();
  const secretHashHex = `0x${secretHash.toString(16).padStart(64, "0")}` as Hex;
  const recipientHex = (aztecRecipient.startsWith("0x") ? aztecRecipient : `0x${aztecRecipient}`) as Hex;

  // Deploy or retrieve the bridge contract
  onStep("approving");
  const bridgeAddr = await deployOrGetBridgeContract(publicClient, walletClient, account, chain);

  if (mint && addresses.feeAssetHandler) {
    // Faucet path: single tx — contract mints + bridges atomically
    onStep("bridging");
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: bridgeContractAbi,
      functionName: "mintAndBridge",
      args: [addresses.feeAssetHandler, addresses.feeJuice, addresses.feeJuicePortal, recipientHex, amount, secretHashHex],
      account,
      chain,
    });
    onStep("waiting-confirmation");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const event = extractDepositEvent(receipt);
    onStep("done");
    return {
      claimSecret: `0x${secret.toString(16).padStart(64, "0")}`,
      claimSecretHash: secretHashHex,
      messageHash: event.key,
      messageLeafIndex: event.index.toString(),
      claimAmount: amount.toString(),
      recipient: aztecRecipient,
    };
  }

  // Non-faucet path: approve bridge contract, then single bridge tx
  const currentAllowance = (await viemReadContract(publicClient, {
    address: addresses.feeJuice,
    abi: erc20ReadAbi,
    functionName: "allowance",
    args: [account, bridgeAddr],
  })) as bigint;
  if (currentAllowance < amount) {
    const approveHash = await walletClient.writeContract({
      address: addresses.feeJuice,
      abi: erc20WriteAbi,
      functionName: "approve",
      args: [bridgeAddr, amount],
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  onStep("bridging");
  const hash = await walletClient.writeContract({
    address: bridgeAddr,
    abi: bridgeContractAbi,
    functionName: "bridge",
    args: [addresses.feeJuice, addresses.feeJuicePortal, recipientHex, amount, secretHashHex],
    account,
    chain,
  });
  onStep("waiting-confirmation");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = extractDepositEvent(receipt);
  onStep("done");

  return {
    claimSecret: `0x${secret.toString(16).padStart(64, "0")}`,
    claimSecretHash: secretHashHex,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: amount.toString(),
    recipient: aztecRecipient,
  };
}

/**
 * Bridges fee juice to two Aztec recipients in a single L1 transaction.
 * Used when the user needs to fund an ephemeral claimer account AND a target recipient.
 *
 * With faucet (testnet): 1 MetaMask prompt (contract mints + double-bridges atomically)
 * Without faucet: 1 approve + 1 bridge = 2 MetaMask prompts
 */
export async function bridgeDouble(params: {
  l1RpcUrl: string;
  chainId: number;
  addresses: L1Addresses;
  ephemeralRecipient: string;
  ephemeralAmount: bigint;
  mainRecipient: string;
  mainAmount: bigint;
  mint: boolean;
  onStep: (step: BridgeStep, label?: string) => void;
}): Promise<{ ephemeral: ClaimCredentials; main: ClaimCredentials }> {
  const { chainId, addresses, ephemeralRecipient, ephemeralAmount, mainRecipient, mainAmount, mint, onStep } = params;
  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error("No EVM wallet found");
  const publicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");

  const totalAmount = ephemeralAmount + mainAmount;

  const ephSecret = await generateClaimSecret();
  const ephSecretHashHex = `0x${ephSecret.secretHash.toString(16).padStart(64, "0")}` as Hex;
  const ephRecipientHex = (ephemeralRecipient.startsWith("0x") ? ephemeralRecipient : `0x${ephemeralRecipient}`) as Hex;

  const mainSecret = await generateClaimSecret();
  const mainSecretHashHex = `0x${mainSecret.secretHash.toString(16).padStart(64, "0")}` as Hex;
  const mainRecipientHex = (mainRecipient.startsWith("0x") ? mainRecipient : `0x${mainRecipient}`) as Hex;

  // Deploy or retrieve the bridge contract
  onStep("approving", "Preparing bridge contract...");
  const bridgeAddr = await deployOrGetBridgeContract(publicClient, walletClient, account, chain);

  let receipt: TransactionReceipt;

  if (mint && addresses.feeAssetHandler) {
    // Faucet path: single tx — contract mints + double-bridges atomically
    onStep("bridging", "Minting & bridging...");
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: bridgeContractAbi,
      functionName: "mintAndBridgeDouble",
      args: [
        addresses.feeAssetHandler, addresses.feeJuice, addresses.feeJuicePortal,
        ephRecipientHex, ephemeralAmount, ephSecretHashHex,
        mainRecipientHex, mainAmount, mainSecretHashHex,
      ],
      account,
      chain,
    });
    onStep("waiting-confirmation", "Waiting for L1 confirmation...");
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } else {
    // Non-faucet path: approve bridge contract, then single double-bridge tx
    const currentAllowance = (await viemReadContract(publicClient, {
      address: addresses.feeJuice,
      abi: erc20ReadAbi,
      functionName: "allowance",
      args: [account, bridgeAddr],
    })) as bigint;
    if (currentAllowance < totalAmount) {
      onStep("approving", "Approving tokens...");
      const approveHash = await walletClient.writeContract({
        address: addresses.feeJuice,
        abi: erc20WriteAbi,
        functionName: "approve",
        args: [bridgeAddr, totalAmount],
        account,
        chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    onStep("bridging", "Bridging to both recipients...");
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: bridgeContractAbi,
      functionName: "bridgeDouble",
      args: [
        addresses.feeJuice, addresses.feeJuicePortal,
        ephRecipientHex, ephemeralAmount, ephSecretHashHex,
        mainRecipientHex, mainAmount, mainSecretHashHex,
      ],
      account,
      chain,
    });
    onStep("waiting-confirmation", "Waiting for L1 confirmation...");
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  }

  // Extract both deposit events from the single receipt
  const events = extractAllDepositEvents(receipt);
  if (events.length < 2) {
    throw new Error(`Expected 2 deposit events, got ${events.length}`);
  }
  // Events are emitted in order: small (ephemeral) first, large (main) second
  const ephEvent = events[0];
  const mainEvent = events[1];

  onStep("done");

  return {
    ephemeral: {
      claimSecret: `0x${ephSecret.secret.toString(16).padStart(64, "0")}`,
      claimSecretHash: ephSecretHashHex,
      messageHash: ephEvent.key,
      messageLeafIndex: ephEvent.index.toString(),
      claimAmount: ephemeralAmount.toString(),
      recipient: ephemeralRecipient,
    },
    main: {
      claimSecret: `0x${mainSecret.secret.toString(16).padStart(64, "0")}`,
      claimSecretHash: mainSecretHashHex,
      messageHash: mainEvent.key,
      messageLeafIndex: mainEvent.index.toString(),
      claimAmount: mainAmount.toString(),
      recipient: mainRecipient,
    },
  };
}

// ── Wallet helpers ───────────────────────────────────────────────────

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

// ── L2 Claim Functions ──────────────────────────────────────────────────────

/**
 * Claims fee juice for the caller's own account.
 * Uses FeeJuicePaymentMethodWithClaim to claim and pay for the tx in one go.
 */
export async function claimFeeJuice(
  wallet: Wallet,
  callerAddress: AztecAddress,
  claim: ClaimCredentials,
) {
  const fj = FeeJuiceContract.at(wallet);
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(callerAddress, {
    claimAmount: BigInt(claim.claimAmount),
    claimSecret: Fr.fromHexString(claim.claimSecret),
    messageLeafIndex: BigInt(claim.messageLeafIndex),
  });

  const executionPayload = await paymentMethod.getExecutionPayload();

  return wallet.sendTx(executionPayload, { from: callerAddress });
}

/**
 * Claims fee juice for both the caller AND a recipient in a single L2 tx.
 *
 * The caller's claim is used as fee payment (via FeeJuicePaymentMethodWithClaim),
 * and the main call claims for the recipient. This turns two L2 txs into one.
 */
export async function claimBothInSingleTx(
  wallet: Wallet,
  callerAddress: AztecAddress,
  callerClaim: ClaimCredentials,
  targetAddress: string,
  recipientClaim: ClaimCredentials,
) {
  const fj = FeeJuiceContract.at(wallet);
  const target = AztecAddress.fromString(targetAddress);

  // The caller's claim pays for gas
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(callerAddress, {
    claimAmount: BigInt(callerClaim.claimAmount),
    claimSecret: Fr.fromHexString(callerClaim.claimSecret),
    messageLeafIndex: BigInt(callerClaim.messageLeafIndex),
  });

  // The main call claims for the recipient
  return fj.methods
    .claim(
      target,
      BigInt(recipientClaim.claimAmount),
      Fr.fromHexString(recipientClaim.claimSecret),
      Fr.fromHexString(
        `0x${BigInt(recipientClaim.messageLeafIndex).toString(16).padStart(64, "0")}`,
      ),
    )
    .send({ from: callerAddress, fee: { paymentMethod } });
}
