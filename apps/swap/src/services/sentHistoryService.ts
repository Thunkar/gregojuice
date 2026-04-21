/**
 * Sent History Service
 * localStorage CRUD for tracking sent offchain transfers
 */

export type SentTransferStatus = "pending" | "confirmed" | "expired";

export interface SentTransfer {
  id: string;
  token: "gc" | "gcp";
  amount: string;
  recipient: string;
  link: string;
  createdAt: number;
  status: SentTransferStatus;
}

function storageKey(senderAddress: string): string {
  return `gregoswap_sent_transfers_${senderAddress}`;
}

export function getSentTransfers(senderAddress: string): SentTransfer[] {
  try {
    const raw = localStorage.getItem(storageKey(senderAddress));
    if (!raw) return [];
    return JSON.parse(raw) as SentTransfer[];
  } catch {
    return [];
  }
}

export function addSentTransfer(senderAddress: string, transfer: SentTransfer): void {
  const existing = getSentTransfers(senderAddress);
  existing.unshift(transfer);
  localStorage.setItem(storageKey(senderAddress), JSON.stringify(existing));
}

export function updateSentTransferStatus(
  senderAddress: string,
  transferId: string,
  status: SentTransferStatus,
): void {
  const transfers = getSentTransfers(senderAddress);
  const index = transfers.findIndex((t) => t.id === transferId);
  if (index !== -1) {
    transfers[index].status = status;
    localStorage.setItem(storageKey(senderAddress), JSON.stringify(transfers));
  }
}
