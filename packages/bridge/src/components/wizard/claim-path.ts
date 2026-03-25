import type { ClaimCredentials, ClaimPath, RecipientChoice } from "./types";

/**
 * Determines the claim strategy based on credentials and wallet state.
 * Returns null if no viable path exists yet (e.g. balance not loaded for third-party claim).
 *
 * allCredentials layout:
 * - length 1: self-claim (the single credential IS the self-claim)
 * - length 2+: allCredentials[0] is the ephemeral (fee payer), rest are recipients
 */
export function determineClaimPath(
  recipientChoice: RecipientChoice,
  allCredentials: ClaimCredentials[],
  feeJuiceBalance: string | null,
): ClaimPath | null {
  if (recipientChoice === "self" && allCredentials.length === 1) {
    return { kind: "self" };
  }

  if (allCredentials.length >= 2) {
    // Ephemeral (fee payer) + N recipients
    return {
      kind: "multiple",
      ephemeral: allCredentials[0],
      others: allCredentials.slice(1),
    };
  }

  // Single credential but not self — third-party claim requires gas
  if (feeJuiceBalance != null && BigInt(feeJuiceBalance) > 0n) {
    return { kind: "for-recipient", recipient: allCredentials[0].recipient };
  }

  return null; // balance not loaded yet, or wallet has no gas
}
