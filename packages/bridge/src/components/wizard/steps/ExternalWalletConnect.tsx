import { useState, useEffect } from "react";
import { Box, Typography, LinearProgress, Alert, Button } from "@mui/material";
import { useNetwork } from "../../../contexts/NetworkContext";
import { useAztecWallet } from "../../../contexts/AztecWalletContext";
import { getAztecNode } from "../../../services";
import { WalletManager } from "@aztec/wallet-sdk/manager";
import { Fr } from "@aztec/foundation/curves/bn254";

export function ExternalWalletConnect() {
  const { activeNetwork } = useNetwork();
  const { connectExternalWallet } = useAztecWallet();
  const [discovered, setDiscovered] = useState<
    Array<{ id: string; name: string; provider: unknown }>
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsDiscovering(true);
    (async () => {
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
        const wallets: typeof discovered = [];
        for await (const provider of session.wallets) {
          if (cancelled) break;
          wallets.push({ id: provider.id, name: provider.name, provider });
          setDiscovered([...wallets]);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Wallet discovery failed");
      } finally {
        if (!cancelled) setIsDiscovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNetwork]);

  const handleConnect = async (provider: unknown) => {
    setIsConnecting(true);
    setErr(null);
    try {
      type P = {
        establishSecureChannel: (appId: string) => Promise<{
          confirm: () => Promise<
            import("@aztec/aztec.js/wallet").Wallet & {
              getAccounts: () => Promise<
                Array<{
                  item: import("@aztec/aztec.js/addresses").AztecAddress;
                }>
              >;
            }
          >;
        }>;
      };
      const p = provider as P;
      const pending = await p.establishSecureChannel("gregojuice");
      const wallet = await pending.confirm();
      const accounts = await wallet.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts available");
      await connectExternalWallet(wallet, accounts[0].item);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  if (isDiscovering) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Discovering wallets...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  if (isConnecting) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Connecting...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box>
      {discovered.length === 0 && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          No wallets found. Make sure your Aztec wallet extension is installed.
        </Alert>
      )}
      {discovered.map((w) => (
        <Button
          key={w.id}
          fullWidth
          variant="outlined"
          color="primary"
          onClick={() => handleConnect(w.provider)}
          sx={{ mb: 1, justifyContent: "flex-start", textTransform: "none" }}
        >
          {w.name}
        </Button>
      ))}
      {err && (
        <Alert severity="error" sx={{ mt: 1, borderRadius: 0 }}>
          {err}
        </Alert>
      )}
    </Box>
  );
}
