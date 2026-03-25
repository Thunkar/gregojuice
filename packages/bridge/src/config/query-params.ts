/**
 * Query parameter parsing for iframe embedding mode.
 *
 * Supported params:
 *   ?recipient=0x...                          — single pre-filled recipient
 *   ?recipients=addr1,amount1;addr2,amount2   — multiple recipients with amounts (FJ, human-readable)
 *   ?network=testnet                          — override the initial network selection
 */

import { parseUnits } from "viem";

export interface RecipientEntry {
  address: string;
  amount: bigint;
}

export interface QueryParams {
  /** Single pre-filled recipient address (legacy, backwards compat) */
  recipient: string | null;
  /** Multiple recipients with amounts (parsed from semicolon-separated pairs) */
  recipients: RecipientEntry[] | null;
  /** Network id to select on boot */
  network: string | null;
  /** True when the app is running inside an iframe */
  isIframe: boolean;
}

let cached: QueryParams | null = null;

/**
 * Parses "addr1,amount1;addr2,amount2" into RecipientEntry[].
 * Amounts are in human-readable FJ (e.g. "1.5" = 1.5 FJ).
 */
function parseRecipients(raw: string): RecipientEntry[] | null {
  if (!raw) return null;
  try {
    const entries = raw.split(";").map((pair) => {
      const [address, amountStr] = pair.split(",");
      if (!address || !amountStr) throw new Error("invalid pair");
      return { address: address.trim(), amount: parseUnits(amountStr.trim(), 18) };
    });
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

export function getQueryParams(): QueryParams {
  if (cached) return cached;
  const params = new URLSearchParams(window.location.search);
  cached = {
    recipient: params.get("recipient"),
    recipients: parseRecipients(params.get("recipients") ?? ""),
    network: params.get("network"),
    isIframe: window.self !== window.top,
  };
  return cached;
}
