import { useEffect, useState, useMemo, useCallback } from "react";
import { Box, Typography, Paper, TextField, Slider, ToggleButtonGroup, ToggleButton } from "@mui/material";
import { formatUnits, parseUnits } from "viem";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { FeePricingService, fetchFeeStats, type FeeStats } from "../services/fee-pricing";
import type { CalibrationResult as CalibrationData } from "../services/calibration";

interface CalibrationResultProps {
  result: CalibrationData;
  maxFeeFj: string;
  onMaxFeeChange: (fj: string) => void;
  maxUses: number;
  maxUsers: number;
}

function computeMaxFee(
  gasLimits: { daGas: number; l2Gas: number },
  teardownGasLimits: { daGas: number; l2Gas: number },
  feePerDaGas: bigint,
  feePerL2Gas: bigint,
): bigint {
  const totalDaGas = BigInt(gasLimits.daGas + teardownGasLimits.daGas);
  const totalL2Gas = BigInt(gasLimits.l2Gas + teardownGasLimits.l2Gas);
  return totalDaGas * feePerDaGas + totalL2Gas * feePerL2Gas;
}

export function CalibrationResult({ result, maxFeeFj, onMaxFeeChange, maxUses, maxUsers }: CalibrationResultProps) {
  const { rollupAddress, l1ChainId, l1RpcUrl, node } = useWallet();
  const { activeNetwork } = useNetwork();

  const [feeSource, setFeeSource] = useState<"p75" | "current">("p75");
  const [stats, setStats] = useState<FeeStats | null>(null);
  const [currentMinFees, setCurrentMinFees] = useState<{ feePerDaGas: bigint; feePerL2Gas: bigint } | null>(null);
  const [feeMultiplier, setFeeMultiplier] = useState(2);
  const [blockRangeInput, setBlockRangeInput] = useState("100");
  const blockRange = parseInt(blockRangeInput) || 0;
  const [perTxUsd, setPerTxUsd] = useState<number | null>(null);

  const pricingService = useMemo(() => {
    const svc = new FeePricingService(l1RpcUrl ?? undefined, l1ChainId ?? undefined);
    if (rollupAddress) svc.init(rollupAddress);
    return svc;
  }, [rollupAddress, l1ChainId, l1RpcUrl]);

  // Fetch fee stats from clustec
  const loadFeeStats = useCallback(() => {
    if (blockRange < 1) { setStats(null); return; }
    fetchFeeStats(activeNetwork.id, blockRange)
      .then(setStats)
      .catch(() => setStats(null));
  }, [activeNetwork.id, blockRange]);

  useEffect(() => { loadFeeStats(); }, [loadFeeStats]);

  // Fetch current min fees from node
  useEffect(() => {
    if (!node || feeSource !== "current") return;
    let cancelled = false;
    (async () => {
      const fees = await node.getCurrentMinFees();
      if (!cancelled) {
        setCurrentMinFees({
          feePerDaGas: BigInt(fees.feePerDaGas),
          feePerL2Gas: BigInt(fees.feePerL2Gas),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [node, feeSource]);

  // Resolved fee-per-gas based on selected source
  const resolvedFeePerDaGas = feeSource === "current"
    ? (currentMinFees?.feePerDaGas ?? null)
    : (stats?.maxFeePerDaGas?.p75 != null ? BigInt(Math.round(Number(stats.maxFeePerDaGas.p75))) : null);
  const resolvedFeePerL2Gas = feeSource === "current"
    ? (currentMinFees?.feePerL2Gas ?? null)
    : (stats?.maxFeePerL2Gas?.p75 != null ? BigInt(Math.round(Number(stats.maxFeePerL2Gas.p75))) : null);

  // Compute max fee from calibrated gas limits × fee-per-gas × multiplier
  useEffect(() => {
    if (resolvedFeePerDaGas === null || resolvedFeePerL2Gas === null) return;
    const multiplierBp = BigInt(Math.round(feeMultiplier * 100));
    const baseFee = computeMaxFee(
      result.gasLimits,
      result.teardownGasLimits,
      resolvedFeePerDaGas,
      resolvedFeePerL2Gas,
    );
    const maxFeeRaw = baseFee * multiplierBp / 100n;
    onMaxFeeChange(formatUnits(maxFeeRaw, 18));
  }, [resolvedFeePerDaGas, resolvedFeePerL2Gas, feeMultiplier, result, onMaxFeeChange]);

  // USD estimate per tx
  useEffect(() => {
    if (!maxFeeFj || !pricingService.enabled) {
      console.debug("USD pricing skipped:", { maxFeeFj, enabled: pricingService.enabled });
      setPerTxUsd(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // parseUnits can fail on too many decimals — truncate to 18
        const truncated = maxFeeFj.includes(".")
          ? maxFeeFj.slice(0, maxFeeFj.indexOf(".") + 19)
          : maxFeeFj;
        const raw = parseUnits(truncated, 18);
        const est = await pricingService.estimateCostUsd(raw);
        if (!cancelled && est) setPerTxUsd(est.costUsd);
      } catch (err) {
        console.error("USD pricing failed:", err);
        if (!cancelled) setPerTxUsd(null);
      }
    })();
    return () => { cancelled = true; };
  }, [maxFeeFj, pricingService]);

  const totalPackageFj = maxFeeFj ? (Number(maxFeeFj) * maxUses * maxUsers).toFixed(6) : null;
  const totalPackageUsd = perTxUsd !== null ? perTxUsd * maxUses * maxUsers : null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Gas Estimates (from calibration)
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">Gas Limits</Typography>
        <Typography variant="caption" sx={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.7rem" }}>
          DA: {result.gasLimits.daGas.toLocaleString()} · L2: {result.gasLimits.l2Gas.toLocaleString()}
        </Typography>
        <Typography variant="caption" color="text.secondary">Teardown</Typography>
        <Typography variant="caption" sx={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.7rem" }}>
          DA: {result.teardownGasLimits.daGas.toLocaleString()} · L2: {result.teardownGasLimits.l2Gas.toLocaleString()}
        </Typography>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Fee per Gas
      </Typography>

      <ToggleButtonGroup
        value={feeSource}
        exclusive
        onChange={(_, v) => { if (v) setFeeSource(v); }}
        size="small"
        sx={{ mb: 1.5 }}
      >
        <ToggleButton value="p75">P75 (last {blockRange} blocks)</ToggleButton>
        <ToggleButton value="current">Current Min Fee</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">DA fee/gas</Typography>
        <Typography variant="caption" sx={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.7rem" }}>
          {resolvedFeePerDaGas != null ? Number(resolvedFeePerDaGas).toLocaleString() : "—"}
        </Typography>
        <Typography variant="caption" color="text.secondary">L2 fee/gas</Typography>
        <Typography variant="caption" sx={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.7rem" }}>
          {resolvedFeePerL2Gas != null ? Number(resolvedFeePerL2Gas).toLocaleString() : "—"}
        </Typography>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Max Fee
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">Safety multiplier on fee/gas</Typography>
          <Slider
            value={feeMultiplier}
            onChange={(_, v) => setFeeMultiplier(v as number)}
            min={1}
            max={10}
            step={0.5}
            marks={[{ value: 1, label: "1x" }, { value: 5, label: "5x" }, { value: 10, label: "10x" }]}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}x`}
            size="small"
          />
        </Box>
        {feeSource === "p75" && (
          <TextField
            label="Blocks"
            type="number"
            value={blockRangeInput}
            onChange={(e) => setBlockRangeInput(e.target.value)}
            size="small"
            sx={{ width: 120 }}
          />
        )}
      </Box>

      <TextField
        fullWidth
        label="Max Fee per tx (FJ)"
        value={maxFeeFj}
        onChange={(e) => onMaxFeeChange(e.target.value)}
        size="small"
        helperText={perTxUsd !== null ? `≈ $${perTxUsd.toFixed(6)} per sponsored tx` : "Adjust multiplier or enter manually"}
        sx={{ mb: 2 }}
      />

      {/* Cost summary */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, p: 1.5, bgcolor: "rgba(212,255,40,0.05)", border: "1px solid", borderColor: "primary.main" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <Typography variant="caption" color="text.secondary">Per tx</Typography>
          <Typography variant="caption" fontWeight={600}>
            {maxFeeFj || "—"} FJ
            {perTxUsd !== null && <Typography component="span" variant="caption" color="text.secondary"> (${perTxUsd.toFixed(6)})</Typography>}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <Typography variant="caption" color="text.secondary">Per subscription ({maxUses} uses)</Typography>
          <Typography variant="caption" fontWeight={600}>
            {maxFeeFj ? (Number(maxFeeFj) * maxUses).toFixed(6) : "—"} FJ
            {perTxUsd !== null && <Typography component="span" variant="caption" color="text.secondary"> (${(perTxUsd * maxUses).toFixed(6)})</Typography>}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid", borderColor: "divider", pt: 0.5 }}>
          <Typography variant="caption" fontWeight={600}>Total ({maxUsers} × {maxUses})</Typography>
          <Typography variant="caption" fontWeight={700} color="primary">
            {totalPackageFj ?? "—"} FJ
            {totalPackageUsd !== null && <Typography component="span" variant="caption" color="text.secondary"> (${totalPackageUsd.toFixed(4)})</Typography>}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}
