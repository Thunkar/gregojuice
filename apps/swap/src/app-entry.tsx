import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { NetworkProvider } from "./contexts/network/NetworkContext";
import { WalletProvider } from "./contexts/wallet/WalletContext";
import { ContractsProvider } from "./contexts/contracts/ContractsContext";
import { SwapProvider } from "./contexts/swap/SwapContext";
import { SendProvider } from "./contexts/send/SendContext";
import { OnboardingProvider } from "./contexts/onboarding/OnboardingContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <ContractsProvider>
          <OnboardingProvider>
            <SwapProvider>
              <SendProvider>
                <App />
              </SendProvider>
            </SwapProvider>
          </OnboardingProvider>
        </ContractsProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
