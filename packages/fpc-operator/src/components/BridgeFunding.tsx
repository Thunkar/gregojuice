import { useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";

interface BridgeFundingProps {
  recipientAddress: string;
  networkId: string;
  bridgeUrl: string;
  onComplete?: () => void;
  onError?: (msg: string) => void;
}

export function BridgeFunding({
  recipientAddress,
  networkId,
  bridgeUrl,
  onComplete,
  onError,
}: BridgeFundingProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "gregojuice-bridge") return;
      if (data.status === "complete") onComplete?.();
      else if (data.status === "error") onError?.(data.error ?? "Bridge failed");
    },
    [onComplete, onError],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const src = `${bridgeUrl}?recipient=${encodeURIComponent(recipientAddress)}&network=${encodeURIComponent(networkId)}`;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Bridge fee juice to fund your FPC contract:
      </Typography>
      <Box
        component="iframe"
        ref={iframeRef}
        src={src}
        allow="ethereum; cross-origin-isolated"
        sx={{
          width: "100%",
          height: 500,
          border: "1px solid",
          borderColor: "divider",
        }}
      />
    </Box>
  );
}
