import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  addStoredContract,
  addStoredSender,
  getStoredContracts,
  getStoredSenders,
  removeStoredContract,
  removeStoredSender,
  type StoredAliased,
} from "../services/aliasService";
import { useNetwork } from "./NetworkContext";

interface AliasContextType {
  contracts: StoredAliased[];
  senders: StoredAliased[];
  addContract: (entry: StoredAliased) => void;
  removeContract: (address: string) => void;
  addSender: (entry: StoredAliased) => void;
  removeSender: (address: string) => void;
}

const AliasContext = createContext<AliasContextType | undefined>(undefined);

export function useAliases() {
  const ctx = useContext(AliasContext);
  if (!ctx) throw new Error("useAliases must be used within an AliasProvider");
  return ctx;
}

export function AliasProvider({ children }: { children: ReactNode }) {
  const { activeNetwork } = useNetwork();
  const networkId = activeNetwork.id;

  const [contracts, setContracts] = useState<StoredAliased[]>([]);
  const [senders, setSenders] = useState<StoredAliased[]>([]);

  useEffect(() => {
    setContracts(getStoredContracts(networkId));
    setSenders(getStoredSenders(networkId));
  }, [networkId]);

  const addContract = useCallback(
    (entry: StoredAliased) => {
      addStoredContract(networkId, entry);
      setContracts(getStoredContracts(networkId));
    },
    [networkId],
  );

  const removeContract = useCallback(
    (address: string) => {
      removeStoredContract(networkId, address);
      setContracts(getStoredContracts(networkId));
    },
    [networkId],
  );

  const addSender = useCallback(
    (entry: StoredAliased) => {
      addStoredSender(networkId, entry);
      setSenders(getStoredSenders(networkId));
    },
    [networkId],
  );

  const removeSender = useCallback(
    (address: string) => {
      removeStoredSender(networkId, address);
      setSenders(getStoredSenders(networkId));
    },
    [networkId],
  );

  const value = useMemo(
    () => ({ contracts, senders, addContract, removeContract, addSender, removeSender }),
    [contracts, senders, addContract, removeContract, addSender, removeSender],
  );

  return <AliasContext.Provider value={value}>{children}</AliasContext.Provider>;
}
