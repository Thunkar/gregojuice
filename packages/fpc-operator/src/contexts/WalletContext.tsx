import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet, txProgress } from "@gregojuice/embedded-wallet";
import { useNetwork } from "./NetworkContext";

type WalletStatus = "disconnected" | "loading" | "ready" | "error";

interface WalletContextType {
  status: WalletStatus;
  wallet: EmbeddedWallet | null;
  address: AztecAddress | null;
  node: AztecNode | null;
  error: string | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { activeNetwork } = useNetwork();
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [wallet, setWallet] = useState<EmbeddedWallet | null>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [node, setNode] = useState<AztecNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setStatus("loading");
    setError(null);

    let cancelled = false;

    (async () => {
      try {
        const w = await EmbeddedWallet.create(activeNetwork.aztecNodeUrl, {
          pxeConfig: { proverEnabled: true },
        });

        if (cancelled) return;

        // Load existing account or create a new one
        let accountManager = await w.loadStoredAccount();
        if (!accountManager) {
          accountManager = await w.createInitializerlessAccount();
        }

        if (cancelled) return;

        const addr = accountManager.address;
        txProgress.setAccount(addr.toString());

        setWallet(w);
        setAddress(addr);
        setNode(w.aztecNode);
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to initialize wallet");
          setStatus("error");
        }
      } finally {
        connectingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      connectingRef.current = false;
    };
  }, [activeNetwork.aztecNodeUrl]);

  return (
    <WalletContext.Provider value={{ status, wallet, address, node, error }}>
      {children}
    </WalletContext.Provider>
  );
}
