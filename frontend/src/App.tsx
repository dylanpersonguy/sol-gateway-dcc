import React, { useMemo, useCallback } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletError } from '@solana/wallet-adapter-base';
import { BridgeInterface } from './components/BridgeInterface';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';

import '@solana/wallet-adapter-react-ui/styles.css';
import { PhantomProvider } from './context/PhantomContext';

const SOLANA_RPC = import.meta.env.VITE_SOLANA_RPC_URL || 'http://127.0.0.1:8899';

// Nuke ALL wallet-related localStorage keys so the adapter never auto-reconnects
if (typeof window !== 'undefined') {
  localStorage.removeItem('walletName');
  localStorage.removeItem('walletName_bridge');
  // Also remove any Wallet Standard keys
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('wallet') || k.startsWith('solana')) {
      localStorage.removeItem(k);
    }
  });
}

function App() {
  const wallets = useMemo(() => [], []);

  const onError = useCallback((error: WalletError) => {
    console.error('[wallet]', error);
    toast.error(error.message || 'Wallet connection failed');
  }, []);

  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} localStorageKey="walletName_bridge" onError={onError}>
        <PhantomProvider>
          <div className="min-h-screen bg-gray-950">
            <Header />
            <main className="max-w-2xl mx-auto px-4 py-8">
              <BridgeInterface />
            </main>
            <StatusBar />
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: '#1f2937',
                  color: '#fff',
                  border: '1px solid #374151',
                },
              }}
            />
          </div>
        </PhantomProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
