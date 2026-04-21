import { ToggleButtonGroup, ToggleButton, Box, Typography, Skeleton, Link } from "@mui/material";
import type { SubscriptionStatus } from "../../services/contractService";

const BRIDGE_URL = "https://bridge.gregojuice.anothercoffeefor.me";

interface SponsorshipToggleProps {
  status: SubscriptionStatus;
  value: boolean; // true = bypass (own funds), false = sponsored
  onChange: (bypass: boolean) => void;
}

function SponsoredLabel({ status }: { status: SubscriptionStatus }) {
  const { kind, availableSlots, remainingUses } = status;

  if (kind === "loading") {
    return <Skeleton variant="text" width={80} sx={{ bgcolor: "rgba(255,255,255,0.08)" }} />;
  }

  if (kind === "sponsored") {
    return (
      <Box>
        <Typography variant="caption" sx={{ display: "block", fontWeight: 600, lineHeight: 1.3 }}>
          Gas-free swap
        </Typography>
        {availableSlots !== undefined && (
          <Typography variant="caption" sx={{ display: "block", opacity: 0.7, lineHeight: 1.3 }}>
            {availableSlots} slot{availableSlots === 1 ? "" : "s"} remaining
          </Typography>
        )}
      </Box>
    );
  }

  if (kind === "active") {
    return (
      <Box>
        <Typography variant="caption" sx={{ display: "block", fontWeight: 600, lineHeight: 1.3 }}>
          Gas-free swap
        </Typography>
        {remainingUses !== undefined && (
          <Typography variant="caption" sx={{ display: "block", opacity: 0.7, lineHeight: 1.3 }}>
            {remainingUses} swap{remainingUses === 1 ? "" : "s"} left
          </Typography>
        )}
      </Box>
    );
  }

  if (kind === "full" || kind === "depleted") {
    const label = kind === "full" ? "No slots available" : "Sponsorship used up";
    return (
      <Box>
        <Typography variant="caption" sx={{ display: "block", fontWeight: 600, lineHeight: 1.3 }}>
          {label}
        </Typography>
        <Link
          href={BRIDGE_URL}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          sx={{ fontSize: "0.7rem", color: "#ff9800", lineHeight: 1.3 }}
        >
          Bridge funds
        </Link>
      </Box>
    );
  }

  return null;
}

export function SponsorshipToggle({ status, value, onChange }: SponsorshipToggleProps) {
  const isBlocked = status.kind === "full" || status.kind === "depleted";

  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      size="small"
      value={value ? "own" : "sponsored"}
      onChange={(_, next) => {
        if (next !== null) onChange(next === "own");
      }}
      sx={{
        mt: 1.5,
        "& .MuiToggleButton-root": {
          fontSize: "0.7rem",
          px: 1.5,
          py: 0.75,
          color: "text.secondary",
          borderColor: "rgba(255,255,255,0.1)",
          textTransform: "none",
          lineHeight: 1.4,
          "&.Mui-selected": {
            color: isBlocked ? "#ff9800" : "#D4FF28",
            backgroundColor: isBlocked ? "rgba(255,152,0,0.1)" : "rgba(212,255,40,0.1)",
            borderColor: isBlocked ? "rgba(255,152,0,0.3)" : "rgba(212,255,40,0.3)",
            "&:hover": {
              backgroundColor: isBlocked ? "rgba(255,152,0,0.15)" : "rgba(212,255,40,0.15)",
            },
          },
          "&:hover": {
            backgroundColor: "rgba(255,255,255,0.04)",
          },
        },
      }}
    >
      <ToggleButton value="sponsored" disabled={isBlocked}>
        <SponsoredLabel status={status} />
      </ToggleButton>
      <ToggleButton value="own">
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          Use my own funds
        </Typography>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
