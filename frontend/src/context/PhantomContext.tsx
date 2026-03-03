import React, { createContext, useContext, useState, useCallback } from 'react';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

type SignTxFn = ((tx: Transaction) => Promise<Transaction>) | null;

interface PhantomContextValue {
  phantomPubkey: string | null;
  setPhantomPubkey: (pk: string | null) => void;
  /** Merged: true if either wallet-adapter OR direct Phantom is connected */
  isConnected: boolean;
  /** Get a PublicKey from either source */
  getPublicKey: (adapterPubkey: PublicKey | null) => PublicKey | null;
  /** signTransaction using direct Phantom provider when adapter hasn't synced */
  getSignTransaction: (adapterSign: SignTxFn) => SignTxFn;
}

const PhantomContext = createContext<PhantomContextValue>({
  phantomPubkey: null,
  setPhantomPubkey: () => {},
  isConnected: false,
  getPublicKey: (pk) => pk,
  getSignTransaction: (fn) => fn,
});

export function PhantomProvider({ children }: { children: React.ReactNode }) {
  const [phantomPubkey, setPhantomPubkey] = useState<string | null>(null);

  const getPublicKey = useCallback(
    (adapterPubkey: PublicKey | null): PublicKey | null => {
      if (adapterPubkey) return adapterPubkey;
      if (phantomPubkey) {
        try { return new PublicKey(phantomPubkey); } catch { return null; }
      }
      return null;
    },
    [phantomPubkey]
  );

  const getSignTransaction = useCallback(
    (adapterSign: SignTxFn): SignTxFn => {
      if (adapterSign) return adapterSign;
      if (!phantomPubkey) return null;
      // Return a function that signs via window.phantom.solana directly
      return async (tx: Transaction) => {
        const w = window as any;
        const provider = w.phantom?.solana ?? w.solana;
        if (!provider) throw new Error('Phantom not available');
        const signed = await provider.signTransaction(tx);
        return signed;
      };
    },
    [phantomPubkey]
  );

  return (
    <PhantomContext.Provider
      value={{
        phantomPubkey,
        setPhantomPubkey,
        isConnected: !!phantomPubkey,
        getPublicKey,
        getSignTransaction,
      }}
    >
      {children}
    </PhantomContext.Provider>
  );
}

export function usePhantom() {
  return useContext(PhantomContext);
}
