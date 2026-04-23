import { useEffect, useRef, useCallback } from "react";
import { Box } from "@mui/material";

interface Recipient {
  address: string;
  /** Amount in human-readable FJ (e.g. "100") */
  amount: string;
}

interface BridgeFundingProps {
  /** Single recipient address (uses ?recipient=) */
  recipient?: string;
  /** Multiple recipients with amounts (uses ?recipients=addr,amt;addr,amt) */
  recipients?: Recipient[];
  networkId: string;
  bridgeUrl: string;
  onComplete?: () => void;
  onError?: (msg: string) => void;
}

export function BridgeFunding({
  recipient,
  recipients,
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
      // Log so CI traces can confirm receipt. Paired with the bridge-side log
      // in useBridgeWizard.ts — if we see one but not the other, the message
      // was dropped; if we see both but setActiveStep doesn't fire, the
      // handler ran but onComplete was stale/undefined.
      // eslint-disable-next-line no-console
      console.log(`[fpc-op] received bridge message: ${JSON.stringify(data)}`);
      if (data.status === "complete") onComplete?.();
      else if (data.status === "error") onError?.(data.error ?? "Bridge failed");
    },
    [onComplete, onError],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const params = new URLSearchParams();
  params.set("network", networkId);
  params.set("embedded", "true");

  if (recipients && recipients.length > 0) {
    params.set("recipients", recipients.map((r) => `${r.address},${r.amount}`).join(";"));
  } else if (recipient) {
    params.set("recipient", recipient);
  }

  const src = `${bridgeUrl}?${params.toString()}`;

  return (
    <Box
      component="iframe"
      ref={iframeRef}
      src={src}
      allow="ethereum; cross-origin-isolated"
      sx={{
        width: "100%",
        height: 500,
        border: "none",
      }}
    />
  );
}
