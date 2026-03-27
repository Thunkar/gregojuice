/**
 * Abbreviates an address string as 0x1234...5678
 */
export function shortAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen + 2) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}
