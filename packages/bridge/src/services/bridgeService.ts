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
import {
  createAztecNodeClient,
  type AztecNode,
  waitForTx,
} from "@aztec/aztec.js/node";
import { computeSecretHash } from "@aztec/aztec.js/crypto";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { TxHash } from "@aztec/stdlib/tx";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { BatchCall } from "@aztec/aztec.js/contracts";

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

import {
  BRIDGE_CONTRACT_ABI,
  BRIDGE_CONTRACT_BYTECODE,
} from "./bridge-contract-artifacts";

const BRIDGE_CONTRACT_STORAGE_KEY = "gregojuice_bridge_contract_v2";

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

/**
 * Info about an L1 bridge tx that's been sent but not yet confirmed.
 * Save this to recover if the user refreshes mid-flight.
 */
export interface PendingBridge {
  l1TxHash: string;
  secrets: Array<{ secret: string; secretHash: string }>;
  recipients: string[];
  amounts: string[];
}

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

type DepositEvent = {
  to: Hex;
  amount: bigint;
  secretHash: Hex;
  key: Hex;
  index: bigint;
};

function extractDepositEvent(receipt: TransactionReceipt): DepositEvent {
  const events = extractAllDepositEvents(receipt);
  if (events.length === 0) {
    throw new Error(
      "DepositToAztecPublic event not found in transaction receipt",
    );
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
  const envAddr = import.meta.env.VITE_BRIDGE_CONTRACT_ADDRESS as
    | string
    | undefined;
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
    abi: BRIDGE_CONTRACT_ABI,
    bytecode: BRIDGE_CONTRACT_BYTECODE,
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress)
    throw new Error("Bridge contract deployment failed");

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
  /** Called after the L1 tx is sent but before receipt — persist this for recovery. */
  onPending?: (pending: PendingBridge) => void;
}): Promise<ClaimCredentials> {
  const {
    chainId,
    addresses,
    aztecRecipient,
    amount,
    mint,
    onStep,
    onPending,
  } = params;
  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error("No EVM wallet found");
  const publicClient = createPublicClient({
    chain,
    transport: custom(window.ethereum),
  });
  const walletClient = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");

  const { secret, secretHash } = await generateClaimSecret();
  const secretHashHex = `0x${secretHash.toString(16).padStart(64, "0")}` as Hex;
  const recipientHex = (
    aztecRecipient.startsWith("0x") ? aztecRecipient : `0x${aztecRecipient}`
  ) as Hex;

  // Deploy or retrieve the bridge contract
  onStep("approving");
  const bridgeAddr = await deployOrGetBridgeContract(
    publicClient,
    walletClient,
    account,
    chain,
  );

  if (mint && addresses.feeAssetHandler) {
    // Faucet path: single tx — contract mints + bridges atomically
    onStep("bridging");
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "mintAndBridge",
      args: [
        addresses.feeAssetHandler,
        addresses.feeJuice,
        addresses.feeJuicePortal,
        recipientHex,
        amount,
        secretHashHex,
      ],
      account,
      chain,
    });
    onStep("waiting-confirmation");
    onPending?.({
      l1TxHash: hash,
      secrets: [
        {
          secret: `0x${secret.toString(16).padStart(64, "0")}`,
          secretHash: secretHashHex,
        },
      ],
      recipients: [aztecRecipient],
      amounts: [amount.toString()],
    });
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
    abi: BRIDGE_CONTRACT_ABI,
    functionName: "bridge",
    args: [
      addresses.feeJuice,
      addresses.feeJuicePortal,
      recipientHex,
      amount,
      secretHashHex,
    ],
    account,
    chain,
  });
  onStep("waiting-confirmation");
  onPending?.({
    l1TxHash: hash,
    secrets: [
      {
        secret: `0x${secret.toString(16).padStart(64, "0")}`,
        secretHash: secretHashHex,
      },
    ],
    recipients: [aztecRecipient],
    amounts: [amount.toString()],
  });
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
 * Bridges fee juice to N Aztec recipients in a single L1 transaction.
 *
 * With faucet (testnet): 1 MetaMask prompt (contract mints + bridges atomically)
 * Without faucet: 1 approve + 1 bridge = 2 MetaMask prompts
 */
export async function bridgeMultiple(params: {
  l1RpcUrl: string;
  chainId: number;
  addresses: L1Addresses;
  recipients: Array<{ address: string; amount: bigint }>;
  mint: boolean;
  onStep: (step: BridgeStep, label?: string) => void;
  onPending?: (pending: PendingBridge) => void;
}): Promise<ClaimCredentials[]> {
  const { chainId, addresses, recipients, mint, onStep, onPending } = params;
  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error("No EVM wallet found");
  const publicClient = createPublicClient({
    chain,
    transport: custom(window.ethereum),
  });
  const walletClient = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");

  const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0n);

  // Generate claim secrets for each recipient
  const secrets = await Promise.all(
    recipients.map(() => generateClaimSecret()),
  );
  const secretHashHexes = secrets.map(
    (s) => `0x${s.secretHash.toString(16).padStart(64, "0")}` as Hex,
  );
  const recipientHexes = recipients.map(
    (r) => (r.address.startsWith("0x") ? r.address : `0x${r.address}`) as Hex,
  );
  const amounts = recipients.map((r) => r.amount);

  // Deploy or retrieve the bridge contract
  onStep("approving", "Preparing bridge contract...");
  const bridgeAddr = await deployOrGetBridgeContract(
    publicClient,
    walletClient,
    account,
    chain,
  );

  // Build PendingBridge for crash recovery
  const pendingBridge: PendingBridge = {
    l1TxHash: "", // filled after send
    secrets: secrets.map((s, i) => ({
      secret: `0x${s.secret.toString(16).padStart(64, "0")}`,
      secretHash: secretHashHexes[i],
    })),
    recipients: recipients.map((r) => r.address),
    amounts: recipients.map((r) => r.amount.toString()),
  };

  let receipt: TransactionReceipt;

  if (mint && addresses.feeAssetHandler) {
    onStep(
      "bridging",
      `Minting & bridging to ${recipients.length} recipients...`,
    );
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "mintAndBridgeMultiple",
      args: [
        addresses.feeAssetHandler,
        addresses.feeJuice,
        addresses.feeJuicePortal,
        recipientHexes,
        amounts,
        secretHashHexes,
      ],
      account,
      chain,
    });
    onStep("waiting-confirmation", "Waiting for L1 confirmation...");
    pendingBridge.l1TxHash = hash;
    onPending?.(pendingBridge);
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } else {
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

    onStep("bridging", `Bridging to ${recipients.length} recipients...`);
    const hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "bridgeMultiple",
      args: [
        addresses.feeJuice,
        addresses.feeJuicePortal,
        recipientHexes,
        amounts,
        secretHashHexes,
      ],
      account,
      chain,
    });
    onStep("waiting-confirmation", "Waiting for L1 confirmation...");
    pendingBridge.l1TxHash = hash;
    onPending?.(pendingBridge);
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  }

  // Extract all deposit events from the single receipt (in order)
  const events = extractAllDepositEvents(receipt);
  if (events.length < recipients.length) {
    throw new Error(
      `Expected ${recipients.length} deposit events, got ${events.length}`,
    );
  }

  onStep("done");

  return recipients.map((r, i) => ({
    claimSecret: `0x${secrets[i].secret.toString(16).padStart(64, "0")}`,
    claimSecretHash: secretHashHexes[i],
    messageHash: events[i].key,
    messageLeafIndex: events[i].index.toString(),
    claimAmount: r.amount.toString(),
    recipient: r.address,
  }));
}

// ── Resume pending L1 bridge ─────────────────────────────────────────

/**
 * Resumes a pending L1 bridge by waiting for the tx receipt and extracting credentials.
 * Used when the user refreshes while waiting for L1 confirmation.
 * Always returns ClaimCredentials[] (length matches pending.secrets).
 */
export async function resumePendingBridge(
  chainId: number,
  pending: PendingBridge,
): Promise<ClaimCredentials[]> {
  const chain = getChain(chainId);
  if (!window.ethereum) throw new Error("No EVM wallet found");
  const publicClient = createPublicClient({
    chain,
    transport: custom(window.ethereum),
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: pending.l1TxHash as Hex,
  });

  const events = extractAllDepositEvents(receipt);
  if (events.length < pending.secrets.length) {
    throw new Error(
      `Expected ${pending.secrets.length} deposit events, got ${events.length}`,
    );
  }

  return pending.secrets.map((s, i) => ({
    claimSecret: s.secret,
    claimSecretHash: s.secretHash,
    messageHash: events[i].key,
    messageLeafIndex: events[i].index.toString(),
    claimAmount: pending.amounts[i],
    recipient: pending.recipients[i],
  }));
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
 * Claims fee juice for the caller and N other recipients in a single L2 tx.
 * The caller's claim pays for gas via FeeJuicePaymentMethodWithClaim.
 * Other claims are batched as fj.claim() calls.
 */
export async function claimAllInSingleTx(
  wallet: Wallet,
  callerAddress: AztecAddress,
  callerClaim: ClaimCredentials,
  otherClaims: ClaimCredentials[],
) {
  const fj = FeeJuiceContract.at(wallet);

  const paymentMethod = new FeeJuicePaymentMethodWithClaim(callerAddress, {
    claimAmount: BigInt(callerClaim.claimAmount),
    claimSecret: Fr.fromHexString(callerClaim.claimSecret),
    messageLeafIndex: BigInt(callerClaim.messageLeafIndex),
  });

  if (otherClaims.length === 1) {
    // Single other recipient — no batch needed
    const c = otherClaims[0];
    const target = AztecAddress.fromString(c.recipient);
    return fj.methods
      .claim(
        target,
        BigInt(c.claimAmount),
        Fr.fromHexString(c.claimSecret),
        Fr.fromHexString(
          `0x${BigInt(c.messageLeafIndex).toString(16).padStart(64, "0")}`,
        ),
      )
      .send({ from: callerAddress, fee: { paymentMethod } });
  }

  // Multiple other recipients — batch all claim calls
  const calls = otherClaims.map((c) => {
    const target = AztecAddress.fromString(c.recipient);
    return fj.methods.claim(
      target,
      BigInt(c.claimAmount),
      Fr.fromHexString(c.claimSecret),
      Fr.fromHexString(
        `0x${BigInt(c.messageLeafIndex).toString(16).padStart(64, "0")}`,
      ),
    );
  });

  const batch = new BatchCall(wallet, calls);
  return batch.send({ from: callerAddress, fee: { paymentMethod } });
}

/**
 * Waits for an already-sent Aztec L2 tx to be mined.
 * Used to resume waiting after a page refresh.
 */
export async function waitForAztecTx(aztecNodeUrl: string, txHashStr: string) {
  const node = getAztecNode(aztecNodeUrl);
  const txHash = TxHash.fromString(txHashStr);
  return waitForTx(node, txHash);
}
