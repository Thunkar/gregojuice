import type { ClaimCredentials, ClaimPath, RecipientChoice } from "./types";

/**
 * Pure function to determine which claim path to use.
 * Returns null if no viable path exists yet (e.g. balance not loaded for third-party claim).
 */
export function determineClaimPath(
  recipientChoice: RecipientChoice,
  ephemeral: ClaimCredentials | null,
  credentials: ClaimCredentials,
  feeJuiceBalance: string | null,
): ClaimPath | null {
  if (recipientChoice === "self") {
    return { kind: "self" };
  }
  if (ephemeral) {
    return { kind: "both", ephemeral, recipient: credentials.recipient };
  }
  // Third-party claim — need gas to send the tx
  if (feeJuiceBalance != null && BigInt(feeJuiceBalance) > 0n) {
    return { kind: "for-recipient", recipient: credentials.recipient };
  }
  return null; // balance not loaded yet, or wallet has no gas
}
