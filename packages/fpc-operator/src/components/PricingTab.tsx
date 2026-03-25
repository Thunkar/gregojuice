import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  Paper,
  LinearProgress,
  Alert,
  Chip,
} from "@mui/material";
import { formatUnits, parseUnits } from "viem";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { FeePricingService, fetchFeeStats, type FeeStats } from "../services/fee-pricing";

function formatFj(raw: string): string {
  try {
    return formatUnits(BigInt(Math.round(Number(raw))), 18);
  } catch {
    return "—";
  }
}

function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

export function PricingTab() {
  const { rollupAddress, l1ChainId, l1RpcUrl } = useWallet();
  const { activeNetwork } = useNetwork();

  const [stats, setStats] = useState<FeeStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{ ethUsdPrice: number; ethPerFeeAssetE12: string } | null>(null);

  // Calculator inputs
  const [maxFeeFj, setMaxFeeFj] = useState("2");
  const [maxUses, setMaxUses] = useState("1");
  const [maxUsers, setMaxUsers] = useState("16");

  // Pricing service (singleton per rollup)
  const pricingService = useMemo(() => {
    const svc = new FeePricingService(l1RpcUrl ?? undefined, l1ChainId ?? undefined);
    if (rollupAddress) svc.init(rollupAddress);
    return svc;
  }, [rollupAddress, l1ChainId, l1RpcUrl]);

  // Fetch fee stats
  const loadStats = useCallback(async () => {
    try {
      setStatsError(null);
      const data = await fetchFeeStats(activeNetwork.id);
      setStats(data);
    } catch {
      setStatsError("Network fee stats unavailable");
    }
  }, [activeNetwork.id]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 60_000);
    return () => clearInterval(interval);
  }, [loadStats]);

  // Fetch pricing
  useEffect(() => {
    if (!pricingService.enabled) return;
    pricingService.getPricing().then(setPricing).catch(() => {});
  }, [pricingService]);

  // ── Derived calculations ───────────────────────────────────────────

  const maxFeeRaw = useMemo(() => {
    try { return parseUnits(maxFeeFj || "0", 18); } catch { return 0n; }
  }, [maxFeeFj]);

  const uses = parseInt(maxUses) || 0;
  const users = parseInt(maxUsers) || 0;

  const perSubscriptionRaw = maxFeeRaw * BigInt(uses);
  const totalPackageRaw = perSubscriptionRaw * BigInt(users);

  // USD estimates
  const [perTxUsd, setPerTxUsd] = useState<number | null>(null);
  const [perSubUsd, setPerSubUsd] = useState<number | null>(null);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);

  useEffect(() => {
    if (!pricingService.enabled || maxFeeRaw === 0n) {
      setPerTxUsd(null);
      setPerSubUsd(null);
      setTotalUsd(null);
      return;
    }
    (async () => {
      const tx = await pricingService.estimateCostUsd(maxFeeRaw);
      const sub = await pricingService.estimateCostUsd(perSubscriptionRaw);
      const total = await pricingService.estimateCostUsd(totalPackageRaw);
      setPerTxUsd(tx?.costUsd ?? null);
      setPerSubUsd(sub?.costUsd ?? null);
      setTotalUsd(total?.costUsd ?? null);
    })();
  }, [pricingService, maxFeeRaw, perSubscriptionRaw, totalPackageRaw]);

  // Network P75 for headroom comparison
  const p75Raw = stats ? BigInt(Math.round(Number(stats.actualFee.p75))) : null;
  const p75Fj = p75Raw ? formatUnits(p75Raw, 18) : null;
  const headroomPct = p75Raw && maxFeeRaw > 0n
    ? Number((maxFeeRaw * 100n) / p75Raw - 100n)
    : null;

  return (
    <Box>
      {/* ── Network Fee Stats ────────────────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Network Fee Stats
      </Typography>

      {statsError && <Alert severity="warning" sx={{ mb: 2 }}>{statsError}</Alert>}

      {stats ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Blocks {stats.blockRange.from}–{stats.blockRange.to}
            </Typography>
            <Chip label={`${stats.txCount} txs`} size="small" variant="outlined" />
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1 }}>
            {(["min", "median", "p75", "max"] as const).map((key) => (
              <Box key={key} sx={{ textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary">{key.toUpperCase()}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {formatFj(stats.actualFee[key])} FJ
                </Typography>
              </Box>
            ))}
          </Box>
          {pricing && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              ETH/USD: ${pricing.ethUsdPrice.toFixed(2)} · Base fee L2: {formatFj(stats.baseFee.l2)} FJ
            </Typography>
          )}
        </Paper>
      ) : (
        !statsError && <LinearProgress sx={{ mb: 3 }} />
      )}

      {/* ── Cost Calculator ───────────────────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Cost Calculator
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <TextField
          label="Max Fee (FJ)"
          value={maxFeeFj}
          onChange={(e) => setMaxFeeFj(e.target.value)}
          size="small"
          type="number"
          sx={{ flex: 1 }}
          helperText={perTxUsd != null ? formatUsd(perTxUsd) + " per tx" : undefined}
        />
        <TextField
          label="Uses / subscription"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          size="small"
          type="number"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Users (slots)"
          value={maxUsers}
          onChange={(e) => setMaxUsers(e.target.value)}
          size="small"
          type="number"
          sx={{ flex: 1 }}
        />
      </Box>

      {/* Headroom bar */}
      {p75Raw && maxFeeRaw > 0n && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Network P75: {p75Fj} FJ
            </Typography>
            <Typography
              variant="caption"
              color={headroomPct != null && headroomPct >= 0 ? "success.main" : "error.main"}
              fontWeight={600}
            >
              {headroomPct != null
                ? headroomPct >= 0
                  ? `+${headroomPct}% headroom`
                  : `${headroomPct}% below P75`
                : ""}
            </Typography>
          </Box>
          <Box sx={{ position: "relative", height: 8, bgcolor: "rgba(255,255,255,0.1)", borderRadius: 1 }}>
            {/* P75 marker */}
            <Box
              sx={{
                position: "absolute",
                left: `${Math.min(100, Number((p75Raw * 100n) / (maxFeeRaw > p75Raw ? maxFeeRaw : p75Raw)))}%`,
                top: 0,
                bottom: 0,
                width: 2,
                bgcolor: "warning.main",
              }}
            />
            {/* Max fee fill */}
            <Box
              sx={{
                height: "100%",
                width: `${Math.min(100, Number((maxFeeRaw * 100n) / (maxFeeRaw > p75Raw ? maxFeeRaw : p75Raw)))}%`,
                bgcolor: maxFeeRaw >= p75Raw ? "primary.main" : "error.main",
                borderRadius: 1,
                opacity: 0.7,
              }}
            />
          </Box>
          {maxFeeRaw < p75Raw && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Max fee is below the network P75. Sponsored transactions may fail due to insufficient fee budget.
            </Alert>
          )}
        </Box>
      )}

      {/* Cost breakdown */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography variant="body2" color="text.secondary">Per transaction</Typography>
            <Typography variant="body2" fontWeight={600}>
              {maxFeeFj || "0"} FJ {perTxUsd != null && <Typography component="span" variant="caption" color="text.secondary">({formatUsd(perTxUsd)})</Typography>}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography variant="body2" color="text.secondary">Per subscription ({uses} uses)</Typography>
            <Typography variant="body2" fontWeight={600}>
              {formatUnits(perSubscriptionRaw, 18)} FJ {perSubUsd != null && <Typography component="span" variant="caption" color="text.secondary">({formatUsd(perSubUsd)})</Typography>}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
            <Typography variant="body2" fontWeight={600}>Total package ({users} users × {uses} uses)</Typography>
            <Typography variant="body2" fontWeight={700} color="primary">
              {formatUnits(totalPackageRaw, 18)} FJ {totalUsd != null && <Typography component="span" variant="caption" color="text.secondary">({formatUsd(totalUsd)})</Typography>}
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Summary card */}
      {totalUsd != null && users > 0 && uses > 0 && (
        <Paper sx={{ p: 2, bgcolor: "rgba(212,255,40,0.05)", border: "1px solid", borderColor: "primary.main" }}>
          <Typography variant="body2" textAlign="center">
            To sponsor <strong>{users} users × {uses} uses</strong> at{" "}
            <strong>{maxFeeFj} FJ</strong> max fee →{" "}
            <Typography component="span" fontWeight={700} color="primary">
              {formatUsd(totalUsd)}
            </Typography>
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
