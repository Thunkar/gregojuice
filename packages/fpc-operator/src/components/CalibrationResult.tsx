import { useEffect, useState, useMemo } from "react";
import { Box, Typography, Paper } from "@mui/material";
import { formatUnits } from "viem";
import { useWallet } from "../contexts/WalletContext";
import { FeePricingService } from "../services/fee-pricing";
import type { CalibrationResult as CalibrationData } from "../services/calibration";

interface CalibrationResultProps {
  result: CalibrationData;
}

export function CalibrationResult({ result }: CalibrationResultProps) {
  const { rollupAddress, l1ChainId, l1RpcUrl } = useWallet();
  const [usdEstimate, setUsdEstimate] = useState<string | null>(null);

  const pricingService = useMemo(() => {
    const svc = new FeePricingService(l1RpcUrl ?? undefined, l1ChainId ?? undefined);
    if (rollupAddress) svc.init(rollupAddress);
    return svc;
  }, [rollupAddress, l1ChainId, l1RpcUrl]);

  useEffect(() => {
    if (!pricingService.enabled || result.maxFee === 0n) return;
    pricingService.estimateCostUsd(result.maxFee).then((r) => {
      if (r) setUsdEstimate(`$${r.costUsd.toFixed(4)}`);
    }).catch(() => {});
  }, [pricingService, result.maxFee]);

  const maxFeeFj = formatUnits(result.maxFee, 18);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Calibration Results
      </Typography>

      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="body2" color="text.secondary">Recommended Max Fee</Typography>
        <Typography variant="body2" fontWeight={700} color="primary">
          {maxFeeFj} FJ {usdEstimate && <Typography component="span" variant="caption" color="text.secondary">({usdEstimate})</Typography>}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Gas Limits (DA / L2)</Typography>
        <Typography variant="caption">
          {result.estimatedGas.gasLimits.daGas} / {result.estimatedGas.gasLimits.l2Gas}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography variant="caption" color="text.secondary">Teardown Gas (DA / L2)</Typography>
        <Typography variant="caption">
          {result.estimatedGas.teardownGasLimits.daGas} / {result.estimatedGas.teardownGasLimits.l2Gas}
        </Typography>
      </Box>
    </Paper>
  );
}
