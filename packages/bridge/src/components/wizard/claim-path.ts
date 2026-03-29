import type { ClaimCredentials, ClaimPath, ClaimKind } from "./types";

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
  allCredentials: ClaimCredentials[],
  feeJuiceBalance: string | null,
  knownClaimKind?: ClaimKind,
): ClaimPath | null {
  if (allCredentials.length === 0) return null;

  let kind: ClaimKind = knownClaimKind ?? "bootstrap";
  if (!knownClaimKind && feeJuiceBalance != null) {
    try {
      if (BigInt(feeJuiceBalance) > 0n) kind = "batch";
    } catch {
      // Invalid balance string — fall back to bootstrap
    }
  }

  if (kind === "batch") {
    return { kind: "batch", claims: allCredentials };
  }

  return {
    kind: "bootstrap",
    bootstrapClaim: allCredentials[0],
    otherClaims: allCredentials.slice(1),
  };
}
