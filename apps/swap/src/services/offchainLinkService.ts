/**
 * Offchain Link Service
 * Encodes/decodes offchain transfer messages into shareable URLs
 */

export interface TransferLink {
  token: "gc" | "gcp";
  amount: string;
  recipient: string;
  contractAddress: string;
  txHash: string;
  anchorBlockTimestamp: string;
  payload: string[];
}

export function encodeTransferLink(data: TransferLink): string {
  const json = JSON.stringify(data);
  const encoded = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${window.location.origin}/#/claim/${encoded}`;
}

export function decodeTransferLink(encoded: string): TransferLink {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(base64);
  return JSON.parse(json) as TransferLink;
}

export function extractClaimPayload(): TransferLink | null {
  const hash = window.location.hash;
  const prefix = "#/claim/";
  if (!hash.startsWith(prefix)) {
    return null;
  }
  try {
    return decodeTransferLink(hash.slice(prefix.length));
  } catch {
    return null;
  }
}

export function isClaimRoute(): boolean {
  return window.location.hash.startsWith("#/claim/");
}
