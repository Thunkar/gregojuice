import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { NetworkProvider } from "./contexts/NetworkContext";
import { WalletProvider } from "./contexts/WalletContext";
import { AliasProvider } from "./contexts/AliasContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <AliasProvider>
          <App />
        </AliasProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
