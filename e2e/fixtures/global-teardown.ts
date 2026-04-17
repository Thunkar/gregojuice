import type { LocalNetwork } from "./local-network.ts";

export default async function globalTeardown(): Promise<void> {
  const network = (globalThis as unknown as { __gjNetwork?: LocalNetwork }).__gjNetwork;
  if (network) {
    await network.stop();
    console.log("[e2e] local-network stopped");
  }
}
