import { useState } from "react";
import { Box, Button, Typography, CircularProgress, Alert, Tabs, Tab } from "@mui/material";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { deployFPC, getStoredFPC } from "../services/fpcService";
import { BridgeFunding } from "./BridgeFunding";

interface FPCDeployProps {
  onDeployed: (fpcAddress: string) => void;
}

export function FPCDeploy({ onDeployed }: FPCDeployProps) {
  const { wallet, address } = useWallet();
  const { activeNetwork } = useNetwork();
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? "http://localhost:5173";
  const stored = getStoredFPC();

  const handleDeploy = async () => {
    if (!wallet || !address) return;
    setDeploying(true);
    setError(null);
    try {
      const { fpcAddress } = await deployFPC(wallet, address);
      onDeployed(fpcAddress.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Box>
      {stored && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Found existing FPC at {stored.address.slice(0, 14)}...
          <Button
            size="small"
            sx={{ ml: 1 }}
            onClick={() => onDeployed(stored.address)}
          >
            Load it
          </Button>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="1. Fund Admin" />
        <Tab label="2. Deploy FPC" />
      </Tabs>

      {tab === 0 && address && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your admin account needs fee juice to deploy the FPC contract.
            Bridge funds to your admin address below, then switch to the
            "Deploy FPC" tab.
          </Typography>
          <BridgeFunding
            recipientAddress={address.toString()}
            networkId={activeNetwork.id}
            bridgeUrl={bridgeUrl}
          />
        </Box>
      )}

      {tab === 1 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Deploy a new SubscriptionFPC contract. Your account will be the
            admin. Make sure you funded your admin account in the previous step.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            fullWidth
            variant="contained"
            onClick={handleDeploy}
            disabled={deploying || !wallet}
          >
            {deploying ? (
              <>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                Deploying...
              </>
            ) : (
              "Deploy FPC"
            )}
          </Button>
        </Box>
      )}
    </Box>
  );
}
