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
} from 'viem';
import { sepolia, mainnet, foundry } from 'viem/chains';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import { isL1ToL2MessageReady } from '@aztec/aztec.js/messaging';

// ── ABIs (separate read vs write to avoid viem authorizationList issues) ──

const erc20ReadAbi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const erc20WriteAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const portalWriteAbi = parseAbi([
  'function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) returns (bytes32, uint256)',
]);

const handlerReadAbi = parseAbi([
  'function mintAmount() view returns (uint256)',
]);

const handlerWriteAbi = parseAbi([
  'function mint(address _recipient)',
]);

// ── Types ────────────────────────────────────────────────────────────

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  1: mainnet,
  31337: foundry,
};

function getChain(chainId: number): Chain {
  return CHAIN_MAP[chainId] ?? { ...sepolia, id: chainId, name: `Chain ${chainId}` };
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
  | 'idle'
  | 'fetching-addresses'
  | 'minting'
  | 'approving'
  | 'bridging'
  | 'waiting-confirmation'
  | 'waiting-l2-sync'
  | 'claimable'
  | 'done'
  | 'error';

// ── Aztec Node Client ────────────────────────────────────────────────

let cachedNode: { url: string; client: AztecNode } | null = null;

export function getAztecNode(aztecNodeUrl: string): AztecNode {
  if (cachedNode && cachedNode.url === aztecNodeUrl) return cachedNode.client;
  const client = createAztecNodeClient(aztecNodeUrl);
  cachedNode = { url: aztecNodeUrl, client };
  return client;
}

export async function fetchL1Addresses(aztecNodeUrl: string): Promise<L1Addresses & { l1ChainId: number }> {
  const node = getAztecNode(aztecNodeUrl);
  const nodeInfo = await node.getNodeInfo();
  const addrs = nodeInfo.l1ContractAddresses;

  const rawHandler = (addrs as Record<string, unknown>).feeAssetHandlerAddress;
  const handlerStr = rawHandler && typeof rawHandler === 'object' && 'toString' in rawHandler
    ? (rawHandler as { toString(): string }).toString()
    : typeof rawHandler === 'string' ? rawHandler : null;
  const isZero = !handlerStr || handlerStr === '0x0000000000000000000000000000000000000000';

  return {
    feeJuicePortal: addrs.feeJuicePortalAddress.toString() as Hex,
    feeJuice: addrs.feeJuiceAddress.toString() as Hex,
    feeAssetHandler: isZero ? null : (handlerStr as Hex),
    l1ChainId: nodeInfo.l1ChainId,
  };
}

// ── L1->L2 Message Readiness ─────────────────────────────────────────

export type MessageStatus = 'pending' | 'ready' | 'error';

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
    const { Fr } = await import('@aztec/foundation/curves/bn254');
    const node = getAztecNode(aztecNodeUrl);
    const msgHash = Fr.fromHexString(messageHash);

    while (!cancelled) {
      try {
        const ready = await isL1ToL2MessageReady(node, msgHash);
        if (ready) {
          onStatus('ready');
          return;
        }
      } catch {
        // Node may not have seen the message yet - keep polling
      }
      // Wait 5 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  };

  onStatus('pending');
  poll().catch(() => {
    if (!cancelled) onStatus('error');
  });

  return { cancel: () => { cancelled = true; } };
}

// ── Claim secret generation ──────────────────────────────────────────

async function generateClaimSecret(): Promise<{ secret: bigint; secretHash: bigint }> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const { computeSecretHash } = await import('@aztec/aztec.js/crypto');
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  return { secret: secret.toBigInt(), secretHash: secretHash.toBigInt() };
}

// ── Read helpers ─────────────────────────────────────────────────────

// Workaround: viem 2.47 requires authorizationList in readContract types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const viemReadContract = (client: any, params: any) => client.readContract(params);

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
    viemReadContract(client, { address: tokenAddress, abi: erc20ReadAbi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
    viemReadContract(client, { address: tokenAddress, abi: erc20ReadAbi, functionName: 'decimals' }) as Promise<number>,
  ]);
  return { balance, formatted: formatUnits(balance, decimals), decimals };
}

export async function getMintAmount(l1RpcUrl: string, chainId: number, handlerAddress: Hex): Promise<bigint> {
  const client = getL1PublicClient(l1RpcUrl, chainId);
  return viemReadContract(client, { address: handlerAddress, abi: handlerReadAbi, functionName: 'mintAmount' }) as Promise<bigint>;
}

// ── Event extraction ─────────────────────────────────────────────────

function extractDepositEvent(receipt: TransactionReceipt) {
  for (const log of receipt.logs) {
    const topics = (log as unknown as { topics: Hex[] }).topics;
    if (!topics || topics.length < 2) continue;

    const data = log.data;
    if (data.length >= 2 + 64 * 4) {
      const amount = BigInt('0x' + data.slice(2, 66));
      const secretHash = ('0x' + data.slice(66, 130)) as Hex;
      const key = ('0x' + data.slice(130, 194)) as Hex;
      const index = BigInt('0x' + data.slice(194, 258));
      const to = topics[1] as Hex;
      return { to, amount, secretHash, key, index };
    }
  }
  throw new Error('DepositToAztecPublic event not found in transaction receipt');
}

// ── Bridge ───────────────────────────────────────────────────────────

export async function bridgeFeeJuice(params: {
  l1RpcUrl: string;
  chainId: number;
  addresses: L1Addresses;
  aztecRecipient: string;
  amount: bigint;
  mint: boolean;
  onStep: (step: BridgeStep) => void;
}): Promise<ClaimCredentials> {
  const { l1RpcUrl, chainId, addresses, aztecRecipient, amount, mint, onStep } = params;

  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error('No EVM wallet found');
  const publicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error('No account connected');

  const { secret, secretHash } = await generateClaimSecret();
  const secretHashHex = `0x${secretHash.toString(16).padStart(64, '0')}` as Hex;
  const recipientHex = (aztecRecipient.startsWith('0x') ? aztecRecipient : `0x${aztecRecipient}`) as Hex;

  // Step 1: Mint (testnet only, when user has no existing balance)
  if (mint && addresses.feeAssetHandler) {
    onStep('minting');
    const mintHash = await walletClient.writeContract({
      address: addresses.feeAssetHandler,
      abi: handlerWriteAbi,
      functionName: 'mint',
      args: [account],
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
  }

  // Step 2: Approve
  onStep('approving');
  const currentAllowance = await viemReadContract(publicClient, {
    address: addresses.feeJuice,
    abi: erc20ReadAbi,
    functionName: 'allowance',
    args: [account, addresses.feeJuicePortal],
  }) as bigint;
  if (currentAllowance < amount) {
    const approveHash = await walletClient.writeContract({
      address: addresses.feeJuice,
      abi: erc20WriteAbi,
      functionName: 'approve',
      args: [addresses.feeJuicePortal, amount],
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // Step 3: Bridge
  onStep('bridging');
  const bridgeHash = await walletClient.writeContract({
    address: addresses.feeJuicePortal,
    abi: portalWriteAbi,
    functionName: 'depositToAztecPublic',
    args: [recipientHex, amount, secretHashHex],
    account,
    chain,
  });

  onStep('waiting-confirmation');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: bridgeHash });

  // Step 4: Extract claim credentials from event
  const event = extractDepositEvent(receipt);
  onStep('done');

  return {
    claimSecret: `0x${secret.toString(16).padStart(64, '0')}`,
    claimSecretHash: secretHashHex,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: amount.toString(),
    recipient: aztecRecipient,
  };
}

/**
 * Bridges twice in one flow: a small amount to an ephemeral account (for gas)
 * and the main amount to the target recipient.
 *
 * Optimized for minimal MetaMask prompts:
 * - Faucet: 2x mint, 1x approve (max uint), 2x deposit = 5 prompts
 * - With balance: 1x approve (if needed), 2x deposit = 2-3 prompts
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
  const { l1RpcUrl, chainId, addresses, ephemeralRecipient, ephemeralAmount, mainRecipient, mainAmount, mint, onStep } = params;
  const chain = getChain(chainId);

  if (!window.ethereum) throw new Error('No EVM wallet found');
  const publicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error('No account connected');

  const totalAmount = ephemeralAmount + mainAmount;

  // Mint (faucet only) — 2 mints fired back-to-back, receipts waited in parallel
  if (mint && addresses.feeAssetHandler) {
    onStep('minting', 'Minting tokens...');
    const mintHash1 = await walletClient.writeContract({
      address: addresses.feeAssetHandler, abi: handlerWriteAbi, functionName: 'mint',
      args: [account], account, chain,
    });
    const mintHash2 = await walletClient.writeContract({
      address: addresses.feeAssetHandler, abi: handlerWriteAbi, functionName: 'mint',
      args: [account], account, chain,
    });
    await Promise.all([
      publicClient.waitForTransactionReceipt({ hash: mintHash1 }),
      publicClient.waitForTransactionReceipt({ hash: mintHash2 }),
    ]);
  }

  // Approve for total amount
  onStep('approving', 'Approving tokens...');
  const currentAllowance = await viemReadContract(publicClient, {
    address: addresses.feeJuice, abi: erc20ReadAbi, functionName: 'allowance',
    args: [account, addresses.feeJuicePortal],
  }) as bigint;
  if (currentAllowance < totalAmount) {
    const approveHash = await walletClient.writeContract({
      address: addresses.feeJuice, abi: erc20WriteAbi, functionName: 'approve',
      args: [addresses.feeJuicePortal, totalAmount], account, chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // Bridge 1: ephemeral account (small)
  onStep('bridging', 'Bridging to claimer account...');
  const ephSecret = await generateClaimSecret();
  const ephSecretHashHex = `0x${ephSecret.secretHash.toString(16).padStart(64, '0')}` as Hex;
  const ephRecipientHex = (ephemeralRecipient.startsWith('0x') ? ephemeralRecipient : `0x${ephemeralRecipient}`) as Hex;

  const ephBridgeHash = await walletClient.writeContract({
    address: addresses.feeJuicePortal, abi: portalWriteAbi, functionName: 'depositToAztecPublic',
    args: [ephRecipientHex, ephemeralAmount, ephSecretHashHex], account, chain,
  });

  // Bridge 2: main recipient — fire immediately, don't wait for first receipt
  onStep('bridging', 'Bridging to recipient...');
  const mainSecret = await generateClaimSecret();
  const mainSecretHashHex = `0x${mainSecret.secretHash.toString(16).padStart(64, '0')}` as Hex;
  const mainRecipientHex = (mainRecipient.startsWith('0x') ? mainRecipient : `0x${mainRecipient}`) as Hex;

  const mainBridgeHash = await walletClient.writeContract({
    address: addresses.feeJuicePortal, abi: portalWriteAbi, functionName: 'depositToAztecPublic',
    args: [mainRecipientHex, mainAmount, mainSecretHashHex], account, chain,
  });

  // Wait for both receipts in parallel
  onStep('waiting-confirmation', 'Waiting for L1 confirmations...');
  const [ephReceipt, mainReceipt] = await Promise.all([
    publicClient.waitForTransactionReceipt({ hash: ephBridgeHash }),
    publicClient.waitForTransactionReceipt({ hash: mainBridgeHash }),
  ]);

  const ephEvent = extractDepositEvent(ephReceipt);
  const mainEvent = extractDepositEvent(mainReceipt);

  onStep('done');

  return {
    ephemeral: {
      claimSecret: `0x${ephSecret.secret.toString(16).padStart(64, '0')}`,
      claimSecretHash: ephSecretHashHex,
      messageHash: ephEvent.key,
      messageLeafIndex: ephEvent.index.toString(),
      claimAmount: ephemeralAmount.toString(),
      recipient: ephemeralRecipient,
    },
    main: {
      claimSecret: `0x${mainSecret.secret.toString(16).padStart(64, '0')}`,
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
  if (!window.ethereum) throw new Error('No wallet found');
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (err: unknown) {
    const error = err as { code?: number };
    if (error.code === 4902) {
      throw new Error(`Chain ${chainId} not configured in your wallet. Please add it manually.`);
    }
    throw err;
  }
}

export async function getConnectedAccount(): Promise<Hex | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as Hex[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(): Promise<Hex> {
  if (!window.ethereum) throw new Error('No EVM wallet found. Please install MetaMask.');
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as Hex[];
  if (!accounts[0]) throw new Error('No account returned');
  return accounts[0];
}
