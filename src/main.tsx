import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { NetworkProvider } from './contexts/NetworkContext';
import { WalletProvider } from './contexts/WalletContext';
import { AztecWalletProvider } from './contexts/AztecWalletContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <AztecWalletProvider>
          <App />
        </AztecWalletProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
