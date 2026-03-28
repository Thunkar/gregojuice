import type { ClaimCredentials, ClaimPath, RecipientChoice } from "./types";

/**
 * Determines the claim strategy based on credentials and wallet state.
 *
 * Two paths:
 * - "bootstrap": wallet has no gas. The first credential pays for the tx via
 *   FeeJuicePaymentMethodWithClaim, the rest are batch-claimed in the same tx.
 * - "batch": wallet already has gas. All credentials are batch-claimed normally.
 *
 * If `knownClaimKind` is provided (from a persisted session), it overrides the
 * balance-based heuristic to avoid misclassifying credentials on restore.
 */
export function determineClaimPath(
  _recipientChoice: RecipientChoice,
  allCredentials: ClaimCredentials[],
  feeJuiceBalance: string | null,
  knownClaimKind?: "bootstrap" | "batch",
): ClaimPath | null {
  if (allCredentials.length === 0) return null;

  const kind = knownClaimKind
    ?? (feeJuiceBalance != null && BigInt(feeJuiceBalance) > 0n ? "batch" : "bootstrap");

  if (kind === "batch") {
    return { kind: "batch", claims: allCredentials };
  }

  return {
    kind: "bootstrap",
    bootstrapClaim: allCredentials[0],
    otherClaims: allCredentials.slice(1),
  };
}
