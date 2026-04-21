import type { Page } from "@playwright/test";
import { createWalletClient, http, hexToBigInt, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Injects a synthetic `window.ethereum` (EIP-1193) provider backed by a
 * viem WalletClient that runs *in Node*. Browser-side calls cross over
 * via `page.exposeBinding` — that way we don't need to resolve `viem`
 * inside the page, which would require vite's bundler.
 *
 * Must be called before `page.goto(...)`.
 */
export interface InjectL1WalletOpts {
  privateKey: `0x${string}`;
  rpcUrl: string;
  chainId: number;
}

/** Anvil dev account #0 — NOT A SECRET. Deterministic across Anvil restarts. */
export const ANVIL_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export async function injectL1Wallet(page: Page, opts: InjectL1WalletOpts): Promise<void> {
  const account = privateKeyToAccount(opts.privateKey);
  const chain: Chain = {
    id: opts.chainId,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] }, public: { http: [opts.rpcUrl] } },
  };
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(opts.rpcUrl),
  });

  // ── Node-side handlers, callable from the page ─────────────────────
  await page.exposeBinding("__e2eL1_getAccount", async (): Promise<string> => account.address);

  await page.exposeBinding(
    "__e2eL1_sendTransaction",
    async (_src, tx: Record<string, string | undefined>): Promise<string> => {
      // Omit `to` entirely when the tx is a contract creation — viem requires
      // it to be *absent*, not null.
      const params: Record<string, unknown> = {
        data: (tx.data ?? undefined) as Hex | undefined,
        value: tx.value ? hexToBigInt(tx.value as Hex) : undefined,
        gas: tx.gas ? hexToBigInt(tx.gas as Hex) : undefined,
        gasPrice: tx.gasPrice ? hexToBigInt(tx.gasPrice as Hex) : undefined,
      };
      if (tx.to) params.to = tx.to;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (walletClient.sendTransaction as any)(params);
    },
  );

  await page.exposeBinding(
    "__e2eL1_personalSign",
    async (_src, rawMessage: string): Promise<string> => {
      return account.signMessage({ message: { raw: rawMessage as Hex } });
    },
  );

  await page.exposeBinding(
    "__e2eL1_signTypedData",
    async (_src, typedDataJson: string): Promise<string> => {
      return account.signTypedData(JSON.parse(typedDataJson));
    },
  );

  // ── Browser-side shim that delegates to the bindings above ─────────
  await page.addInitScript(
    ({ rpcUrl, chainId }: { rpcUrl: string; chainId: number }) => {
      const ns = globalThis as unknown as {
        ethereum?: unknown;
        __e2eL1_getAccount: () => Promise<string>;
        __e2eL1_sendTransaction: (tx: Record<string, string | undefined>) => Promise<string>;
        __e2eL1_personalSign: (msg: string) => Promise<string>;
        __e2eL1_signTypedData: (td: string) => Promise<string>;
      };

      const rpcPassthrough = async (method: string, params: unknown[] = []): Promise<unknown> => {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const json = (await res.json()) as {
          result?: unknown;
          error?: { message: string };
        };
        if (json.error) throw new Error(json.error.message);
        return json.result;
      };

      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

      const ethereum = {
        isMetaMask: false,
        isE2EStub: true,

        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [await ns.__e2eL1_getAccount()];

            case "eth_chainId":
              return "0x" + chainId.toString(16);

            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;

            case "wallet_requestPermissions":
              return [{ parentCapability: "eth_accounts" }];

            case "wallet_revokePermissions":
              return null;

            case "eth_sendTransaction": {
              const tx = (params as Array<Record<string, string>>)[0] ?? {};
              return ns.__e2eL1_sendTransaction(tx);
            }

            case "personal_sign":
            case "eth_sign": {
              const rawMessage = (params as string[])[0];
              return ns.__e2eL1_personalSign(rawMessage);
            }

            case "eth_signTypedData_v4": {
              const typedDataJson = (params as string[])[1];
              return ns.__e2eL1_signTypedData(typedDataJson);
            }

            // Everything else passes straight through to Anvil.
            default:
              return rpcPassthrough(method, params);
          }
        },

        on(event: string, handler: (...args: unknown[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(handler);
        },

        removeListener(event: string, handler: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(handler);
        },
      };

      Object.defineProperty(window, "ethereum", {
        value: ethereum,
        writable: true,
        configurable: true,
      });
    },
    { rpcUrl: opts.rpcUrl, chainId: opts.chainId },
  );
}
