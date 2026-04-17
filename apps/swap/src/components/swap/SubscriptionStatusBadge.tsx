import { Box, Chip, Link, Skeleton, Typography } from "@mui/material";
import type { SubscriptionStatus } from "../../services/contractService";

const BRIDGE_URL = "https://bridge.gregojuice.anothercoffeefor.me";

interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  compact?: boolean;
}

export function SubscriptionStatusBadge({ status, compact = false }: SubscriptionStatusBadgeProps) {
  const { kind, availableSlots, remainingUses } = status;

  if (kind === "no_fpc") return null;

  if (kind === "loading") {
    return (
      <Box sx={{ mt: compact ? 0 : 1.5, display: "flex", justifyContent: "center" }}>
        <Skeleton
          variant="rounded"
          width={140}
          height={22}
          sx={{ bgcolor: "rgba(255,255,255,0.06)" }}
        />
      </Box>
    );
  }

  const isFree = kind === "sponsored" || kind === "active";
  const chipColor = isFree ? "#D4FF28" : "#ff9800";
  const chipLabel = isFree
    ? "Gas-free swap"
    : kind === "full"
      ? "No slots available"
      : "Sponsorship used up";

  const slotsText =
    availableSlots !== undefined
      ? `${availableSlots} slot${availableSlots === 1 ? "" : "s"} remaining`
      : null;
  const usesText =
    remainingUses !== undefined
      ? `${remainingUses} swap${remainingUses === 1 ? "" : "s"} left`
      : null;

  const detail =
    kind === "sponsored" ? (
      <>First swap activates a sponsored slot.{slotsText ? ` ${slotsText}.` : ""}</>
    ) : kind === "active" ? (
      <>
        {usesText ?? "Sponsored uses remaining."}
        {slotsText ? (
          <>
            <br />
            {slotsText} for new users.
          </>
        ) : (
          ""
        )}
      </>
    ) : kind === "full" ? (
      <>
        Sponsorship is full.{" "}
        <Link href={BRIDGE_URL} target="_blank" rel="noopener" sx={{ color: "#ff9800" }}>
          Bridge funds
        </Link>{" "}
        to continue.
      </>
    ) : (
      <>
        Your uses are exhausted.{" "}
        <Link href={BRIDGE_URL} target="_blank" rel="noopener" sx={{ color: "#ff9800" }}>
          Bridge funds
        </Link>{" "}
        to continue.
      </>
    );

  return (
    <Box
      sx={{
        mt: compact ? 0 : 1.5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
      }}
    >
      <Chip
        label={chipLabel}
        size="small"
        sx={{
          backgroundColor: `${chipColor}18`,
          color: chipColor,
          border: `1px solid ${chipColor}40`,
          fontWeight: 600,
          fontSize: "0.7rem",
          height: 22,
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
        {detail}
      </Typography>
    </Box>
  );
}
