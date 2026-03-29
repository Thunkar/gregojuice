import type { ClaimCredentials, ClaimPath, ClaimKind } from "./types";

/**
 * Determines the claim execution strategy based on credentials and wallet state.
 *
 * Three paths:
 * - "self":      single credential, wallet pays gas (external wallet self-bridge)
 * - "bootstrap": wallet has no gas — first credential pays via FeeJuicePaymentMethodWithClaim
 * - "batch":     wallet already has gas — all credentials batch-claimed normally
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

  // "self" and "batch" both use the same batch claim path — wallet pays gas
  if (kind === "batch" || kind === "self") {
    return { kind: "batch", claims: allCredentials };
  }

  return {
    kind: "bootstrap",
    bootstrapClaim: allCredentials[0],
    otherClaims: allCredentials.slice(1),
  };
}
