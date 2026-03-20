import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { useAztecWallet } from "../contexts/AztecWalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import { getAztecNode, type ClaimCredentials } from "../services/bridgeService";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { WalletManager } from "@aztec/wallet-sdk/manager";

interface ClaimPanelProps {
  credentials: ClaimCredentials;
  messageReady: boolean;
}

type ClaimMethod = "embedded" | "external";

export function ClaimPanel({ credentials, messageReady }: ClaimPanelProps) {
  const {
    status,
    address,
    connectAztecWallet,
    connectExternalWallet,
    deployWithClaim,
    claimForRecipient,
    error,
  } = useAztecWallet();
  const { activeNetwork } = useNetwork();

  const isSelfClaim = address && credentials.recipient === address.toString();
  const hasWallet =
    status === "ready" || status === "deployed" || status === "deploying";

  const [claimMethod, setClaimMethod] = useState<ClaimMethod | null>(null);
  const [discoveredWallets, setDiscoveredWallets] = useState<
    Array<{ id: string; name: string; provider: unknown }>
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleClaim = async () => {
    if (isSelfClaim) {
      await deployWithClaim(credentials);
    } else {
      await claimForRecipient(credentials, credentials.recipient);
    }
  };

  const startDiscovery = async () => {
    setIsDiscovering(true);
    try {
      const node = getAztecNode(activeNetwork.aztecNodeUrl);
      const nodeInfo = await node.getNodeInfo();

      const chainInfo = {
        chainId: Fr.fromString(nodeInfo.l1ChainId.toString()),
        version: Fr.fromString(nodeInfo.rollupVersion.toString()),
      };

      const session = WalletManager.configure({
        extensions: { enabled: true },
      }).getAvailableWallets({
        chainInfo,
        appId: "gregojuice",
        timeout: 5000,
      });

      const wallets: typeof discoveredWallets = [];
      for await (const provider of session.wallets) {
        wallets.push({ id: provider.id, name: provider.name, provider });
        setDiscoveredWallets([...wallets]);
      }
      if (wallets.length === 0) {
        setDiscoveredWallets([]);
      }
    } catch (err) {
      console.warn("Wallet discovery failed:", err);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleConnectExternal = async (provider: unknown) => {
    setIsConnecting(true);
    try {
      const p = provider as {
        establishSecureChannel: (appId: string) => Promise<{
          confirm: () => Promise<
            Wallet & {
              getAccounts: () => Promise<Array<{ item: AztecAddress }>>;
            }
          >;
        }>;
      };
      const pending = await p.establishSecureChannel("gregojuice");
      const wallet = await pending.confirm();
      const accounts = await wallet.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts available");
      await connectExternalWallet(wallet, accounts[0].item);
    } catch (err) {
      console.error("Failed to connect external wallet:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (
      claimMethod === "external" &&
      discoveredWallets.length === 0 &&
      !isDiscovering
    ) {
      startDiscovery();
    }
  }, [claimMethod]);

  // Wallet already connected — show claim button
  if (hasWallet) {
    const claimLabel = isSelfClaim
      ? status === "deployed"
        ? "Claim Fee Juice"
        : "Deploy Account & Claim Fee Juice"
      : "Claim for Recipient";

    return (
      <Box>
        {status === "deploying" ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              {isSelfClaim
                ? "Deploying and claiming..."
                : "Claiming for recipient..."}
            </Typography>
          </Box>
        ) : (
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={handleClaim}
            disabled={!messageReady}
          >
            {messageReady ? claimLabel : "Waiting for L2 message..."}
          </Button>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1, borderRadius: 0 }}>
            {error}
          </Alert>
        )}
      </Box>
    );
  }

  // No wallet — show options
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        An Aztec account is needed to submit the claim transaction.
      </Typography>

      <ToggleButtonGroup
        value={claimMethod}
        exclusive
        onChange={(_, v) => {
          if (v) setClaimMethod(v);
        }}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="external">I Have a Wallet</ToggleButton>
        <ToggleButton value="embedded">Create Account</ToggleButton>
      </ToggleButtonGroup>

      {/* External wallet discovery */}
      {claimMethod === "external" && (
        <Box>
          {isDiscovering && (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}
            >
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Discovering wallets...
              </Typography>
            </Box>
          )}
          {isConnecting && (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}
            >
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Connecting...
              </Typography>
            </Box>
          )}
          {!isDiscovering &&
            !isConnecting &&
            discoveredWallets.length === 0 && (
              <Alert severity="info" sx={{ borderRadius: 0 }}>
                No wallets found. Make sure your Aztec wallet extension is
                installed.
              </Alert>
            )}
          {!isConnecting &&
            discoveredWallets.map((w) => (
              <Button
                key={w.id}
                fullWidth
                variant="outlined"
                color="primary"
                onClick={() => handleConnectExternal(w.provider)}
                sx={{
                  mb: 1,
                  justifyContent: "flex-start",
                  textTransform: "none",
                }}
              >
                {w.name}
              </Button>
            ))}
        </Box>
      )}

      {/* Embedded account creation */}
      {claimMethod === "embedded" && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            A new account will be created. You'll need to bridge a small amount
            to it first to cover the claim transaction gas.
          </Typography>
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={connectAztecWallet}
            disabled={status === "creating"}
          >
            {status === "creating" ? "Creating..." : "Create Account"}
          </Button>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 1, borderRadius: 0 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
