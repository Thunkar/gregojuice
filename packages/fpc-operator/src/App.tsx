import { useState, useEffect, useCallback } from "react";
import {
  ThemeProvider,
  CssBaseline,
  Container,
  Box,
  Typography,
  CircularProgress,
  Tabs,
  Tab,
  Paper,
  Alert,
  Chip,
} from "@mui/material";
import { theme } from "./theme";
import { useWallet } from "./contexts/WalletContext";
import { useNetwork } from "./contexts/NetworkContext";
import { getStoredFPC, loadExistingFPC } from "./services/fpcService";
import { FPCDeploy } from "./components/FPCDeploy";
import { AppSignUp } from "./components/AppSignUp";
import { AppList } from "./components/AppList";
import { BridgeFunding } from "./components/BridgeFunding";
import { TxNotificationCenter } from "./components/TxNotificationCenter";
import { GregoJuiceLogo } from "./components/GregoJuiceLogo";
import type { SubscriptionFPCContract as SubscriptionFPC } from "@gregojuice/contracts/artifacts/SubscriptionFPC";

export function App() {
  const { status, wallet, address, node, error: walletError } = useWallet();
  const { activeNetwork } = useNetwork();
  const [fpc, setFpc] = useState<SubscriptionFPC | null>(null);
  const [fpcAddress, setFpcAddress] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? "http://localhost:5173";

  const handleFPCDeployed = useCallback(
    async (addr: string) => {
      if (!wallet || !node) return;
      setFpcAddress(addr);
      setLoadError(null);
      try {
        const loaded = await loadExistingFPC(wallet, node, {
          address: addr,
          secretKey: getStoredFPC()?.secretKey ?? "",
        });
        setFpc(loaded);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load FPC");
      }
    },
    [wallet, node],
  );

  useEffect(() => {
    if (status !== "ready" || !wallet) return;
    const stored = getStoredFPC();
    if (stored) {
      handleFPCDeployed(stored.address);
    }
  }, [status, wallet, handleFPCDeployed]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "background.default",
          py: 4,
          position: "relative",
          overflow: "hidden",
          "&::before": {
            content: '""',
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: "url(/background.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            filter: "grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)",
            opacity: 0.6,
            zIndex: 0,
          },
        }}
      >
        <Container maxWidth="sm" sx={{ position: "relative", zIndex: 1 }}>
          {/* Header */}
          <Box sx={{ textAlign: "center", mb: 6, mt: 4 }}>
            <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
              <GregoJuiceLogo height={56} />
            </Box>
            <Typography variant="body1" color="text.secondary">
              FPC Operator Dashboard
            </Typography>
          </Box>

          {/* Status chips */}
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1, mb: 3 }}>
            <Chip
              label={activeNetwork.name}
              size="small"
              variant="outlined"
            />
            {address && (
              <Chip
                label={`Admin: ${address.toString().slice(0, 10)}...`}
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
            {fpcAddress && (
              <Chip
                label={`FPC: ${fpcAddress.slice(0, 10)}...`}
                size="small"
                color="success"
                variant="outlined"
              />
            )}
          </Box>

          {/* Main content */}
          <Paper sx={{ p: 3 }}>
            {status === "loading" && (
              <Box sx={{ textAlign: "center", py: 6 }}>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography color="text.secondary">
                  Initializing embedded wallet...
                </Typography>
              </Box>
            )}

            {status === "error" && (
              <Alert severity="error">{walletError}</Alert>
            )}

            {status === "ready" && !fpc && !loadError && (
              <FPCDeploy onDeployed={handleFPCDeployed} />
            )}

            {loadError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {loadError}
              </Alert>
            )}

            {status === "ready" && fpc && address && (
              <>
                <Tabs
                  value={tab}
                  onChange={(_, v) => setTab(v)}
                  sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
                >
                  <Tab label="Sign Up App" />
                  <Tab label="Registered Apps" />
                  <Tab label="Fund Admin" />
                  {fpcAddress && <Tab label="Fund FPC" />}
                </Tabs>

                {tab === 0 && (
                  <AppSignUp
                    fpc={fpc}
                    adminAddress={address}
                    onSignedUp={() => setListKey((k) => k + 1)}
                  />
                )}
                {tab === 1 && <AppList key={listKey} fpc={fpc} />}
                {tab === 2 && (
                  <Box>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Fund Admin Account
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Your admin account needs fee juice to send transactions
                      (deploying the FPC, signing up apps). Bridge funds to your
                      admin address below.
                    </Typography>
                    <BridgeFunding
                      recipientAddress={address.toString()}
                      networkId={activeNetwork.id}
                      bridgeUrl={bridgeUrl}
                    />
                  </Box>
                )}
                {tab === 3 && fpcAddress && (
                  <Box>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Fund FPC Contract
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      The FPC needs fee juice to sponsor transactions for your
                      users. Bridge funds to the FPC address below.
                    </Typography>
                    <BridgeFunding
                      recipientAddress={fpcAddress}
                      networkId={activeNetwork.id}
                      bridgeUrl={bridgeUrl}
                    />
                  </Box>
                )}
              </>
            )}
          </Paper>

          {/* Footer */}
          <Box sx={{ textAlign: "center", mt: 4, mb: 2 }}>
            <Typography variant="body2" sx={{ color: "rgba(242, 238, 225, 0.4)" }}>
              Deploy and manage Subscription FPC contracts for sponsoring
              user transactions on Aztec.
            </Typography>
          </Box>
        </Container>
      </Box>

      <TxNotificationCenter account={address?.toString()} />
    </ThemeProvider>
  );
}
