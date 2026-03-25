import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { FunctionSelector } from "@aztec/aztec.js/abi";
import type { SubscriptionFPCContract as SubscriptionFPC } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import {
  getSignedUpApps,
  computeConfigId,
  queryAvailableSlots,
  type SignedUpApp,
} from "../services/fpcService";

interface SlotInfo {
  available: number | null;
  loading: boolean;
}

interface AppListProps {
  fpc: SubscriptionFPC;
}

export function AppList({ fpc }: AppListProps) {
  const [apps, setApps] = useState<SignedUpApp[]>([]);
  const [slotInfo, setSlotInfo] = useState<Record<string, SlotInfo>>({});

  const loadApps = useCallback(() => {
    setApps(getSignedUpApps());
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const refreshSlots = useCallback(async () => {
    if (apps.length === 0) return;

    // Set all to loading
    const loading: Record<string, SlotInfo> = {};
    for (const app of apps) {
      const key = `${app.appAddress}:${app.functionSelector}:${app.configIndex}`;
      loading[key] = { available: null, loading: true };
    }
    setSlotInfo(loading);

    // Query each in parallel
    const results = await Promise.allSettled(
      apps.map(async (app) => {
        const configId = await computeConfigId(
          AztecAddress.fromString(app.appAddress),
          FunctionSelector.fromString(app.functionSelector),
          app.configIndex,
        );
        const available = await queryAvailableSlots(fpc, configId);
        return {
          key: `${app.appAddress}:${app.functionSelector}:${app.configIndex}`,
          available,
        };
      }),
    );

    const updated: Record<string, SlotInfo> = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        updated[result.value.key] = {
          available: result.value.available,
          loading: false,
        };
      }
    }
    setSlotInfo(updated);
  }, [apps, fpc]);

  useEffect(() => {
    if (apps.length > 0) refreshSlots();
  }, [apps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (apps.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography color="text.secondary">
          No apps signed up yet. Use the "Sign Up" tab to register your first
          app.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">Registered Apps</Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={refreshSlots}
        >
          Refresh
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>App Address</TableCell>
              <TableCell>Selector</TableCell>
              <TableCell align="center">Index</TableCell>
              <TableCell align="center">Uses</TableCell>
              <TableCell align="center">Slots</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {apps.map((app, i) => {
              const key = `${app.appAddress}:${app.functionSelector}:${app.configIndex}`;
              const info = slotInfo[key];
              return (
                <TableRow key={i}>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {app.appAddress.slice(0, 10)}...{app.appAddress.slice(-4)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {app.functionSelector}
                  </TableCell>
                  <TableCell align="center">{app.configIndex}</TableCell>
                  <TableCell align="center">{app.maxUses}</TableCell>
                  <TableCell align="center">
                    {info?.loading ? (
                      <CircularProgress size={16} />
                    ) : info?.available != null ? (
                      <Chip
                        label={`${info.available} / ${app.maxUsers}`}
                        size="small"
                        color={info.available > 0 ? "success" : "error"}
                        variant="outlined"
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
