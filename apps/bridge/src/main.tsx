import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { NetworkProvider } from "./contexts/NetworkContext";
import { WalletProvider } from "./contexts/WalletContext";
import { AztecWalletProvider } from "./contexts/AztecWalletContext";
import { getQueryParams } from "./config/query-params";

const { network } = getQueryParams();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NetworkProvider defaultNetworkId={network}>
      <WalletProvider>
        <AztecWalletProvider>
          <App />
        </AztecWalletProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
