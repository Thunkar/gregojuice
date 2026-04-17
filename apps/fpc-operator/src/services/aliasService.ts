const CONTRACTS_KEY_PREFIX = "gregojuice_aliased_contracts";
const SENDERS_KEY_PREFIX = "gregojuice_aliased_senders";

export interface StoredAliased {
  address: string;
  alias: string;
}

const contractsKey = (networkId: string) => `${CONTRACTS_KEY_PREFIX}:${networkId}`;
const sendersKey = (networkId: string) => `${SENDERS_KEY_PREFIX}:${networkId}`;

function read(key: string): StoredAliased[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(key: string, list: StoredAliased[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

export const getStoredContracts = (networkId: string) => read(contractsKey(networkId));

export const saveStoredContracts = (networkId: string, list: StoredAliased[]) =>
  write(contractsKey(networkId), list);

export function addStoredContract(networkId: string, entry: StoredAliased) {
  const list = getStoredContracts(networkId).filter((c) => c.address !== entry.address);
  list.push(entry);
  saveStoredContracts(networkId, list);
}

export function removeStoredContract(networkId: string, address: string) {
  saveStoredContracts(
    networkId,
    getStoredContracts(networkId).filter((c) => c.address !== address),
  );
}

export const getStoredSenders = (networkId: string) => read(sendersKey(networkId));

export const saveStoredSenders = (networkId: string, list: StoredAliased[]) =>
  write(sendersKey(networkId), list);

export function addStoredSender(networkId: string, entry: StoredAliased) {
  const list = getStoredSenders(networkId).filter((s) => s.address !== entry.address);
  list.push(entry);
  saveStoredSenders(networkId, list);
}

export function removeStoredSender(networkId: string, address: string) {
  saveStoredSenders(
    networkId,
    getStoredSenders(networkId).filter((s) => s.address !== address),
  );
}

export function clearAliases(networkId: string) {
  localStorage.removeItem(contractsKey(networkId));
  localStorage.removeItem(sendersKey(networkId));
}
