export interface NetworkConfig {
  id: string;
  name: string;
  aztecNodeUrl: string;
  l1RpcUrl: string;
  l1ChainId: number;
}

const NETWORKS: NetworkConfig[] = [
  {
    id: 'testnet',
    name: 'Aztec Testnet (Sepolia)',
    aztecNodeUrl: 'https://rpc.testnet.aztec-labs.com',
    l1RpcUrl: 'https://rpc.sepolia.org',
    l1ChainId: 11155111,
  },
];

// Allow overriding via environment variables
if (import.meta.env.VITE_CUSTOM_AZTEC_NODE_URL) {
  NETWORKS.push({
    id: 'custom',
    name: 'Custom Network',
    aztecNodeUrl: import.meta.env.VITE_CUSTOM_AZTEC_NODE_URL,
    l1RpcUrl: import.meta.env.VITE_CUSTOM_L1_RPC_URL ?? 'http://localhost:8545',
    l1ChainId: Number(import.meta.env.VITE_CUSTOM_L1_CHAIN_ID ?? '31337'),
  });
}

export function getNetworks(): NetworkConfig[] {
  return NETWORKS;
}

export function getDefaultNetwork(): NetworkConfig {
  return NETWORKS[0];
}
