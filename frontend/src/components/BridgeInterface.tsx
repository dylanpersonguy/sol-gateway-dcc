import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { usePhantom } from '../context/PhantomContext';
import { useBridgeStore, BridgeDirection } from '../hooks/useBridgeStore';
import { DepositForm } from './DepositForm';
import { RedeemForm } from './RedeemForm';
import { TransferProgress } from './TransferProgress';
import { TokenSelector, TokenLogo } from './TokenSelector';
import { BRIDGE_TOKENS, CATEGORY_LABELS, type BridgeToken } from '../config/tokens';

export function BridgeInterface() {
  const { connected } = useWallet();
  const { isConnected } = usePhantom();
  const { direction, setDirection, activeTransfer, selectedToken, setSelectedToken } = useBridgeStore();

  if (activeTransfer) {
    return <TransferProgress />;
  }

  return (
    <div className="space-y-6">
      {/* Direction Toggle */}
      <div className="card">
        <div className="flex gap-2 p-1 bg-gray-800 rounded-xl">
          <button
            onClick={() => setDirection('sol_to_dcc')}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              direction === 'sol_to_dcc'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>{selectedToken.symbol}</span>
            <span>→</span>
            <span>{selectedToken.wrappedSymbol}.DCC</span>
          </button>
          <button
            onClick={() => setDirection('dcc_to_sol')}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              direction === 'dcc_to_sol'
                ? 'bg-teal-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>{selectedToken.wrappedSymbol}.DCC</span>
            <span>→</span>
            <span>{selectedToken.symbol}</span>
          </button>
        </div>
      </div>

      {/* Main Form */}
      {!connected && !isConnected ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 text-lg mb-4">
            Connect your Phantom wallet to start bridging
          </p>
          <p className="text-gray-500 text-sm">
            Bridge {BRIDGE_TOKENS.length} tokens between Solana and DecentralChain
          </p>
        </div>
      ) : direction === 'sol_to_dcc' ? (
        <DepositForm />
      ) : (
        <RedeemForm />
      )}

      {/* Supported Tokens */}
      <SupportedTokens selectedToken={selectedToken} onSelect={setSelectedToken} />

      {/* Security Info */}
      <div className="card bg-gray-900/50">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Security Features
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            M-of-N validator consensus
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            PDA-controlled vault
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            32+ block finality
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Rate-limited withdrawals
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Emergency circuit breakers
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            1:1 collateralized
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Supported Tokens Grid ── */

function SupportedTokens({
  selectedToken,
  onSelect,
}: {
  selectedToken: BridgeToken;
  onSelect: (t: BridgeToken) => void;
}) {
  const categoryOrder: BridgeToken['category'][] = [
    'native', 'stablecoin', 'btc', 'eth', 'ecosystem', 'meme',
  ];

  const grouped = BRIDGE_TOKENS.reduce<Record<string, BridgeToken[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">
        Supported Tokens
        <span className="text-gray-500 font-normal ml-2">({BRIDGE_TOKENS.length})</span>
      </h3>

      <div className="space-y-4">
        {categoryOrder.map((cat) => {
          const tokens = grouped[cat];
          if (!tokens) return null;
          return (
            <div key={cat}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {CATEGORY_LABELS[cat]}
              </div>
              <div className="flex flex-wrap gap-2">
                {tokens.map((token) => {
                  const isSelected = token.splMint === selectedToken.splMint;
                  return (
                    <button
                      key={token.splMint}
                      onClick={() => onSelect(token)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                        isSelected
                          ? 'border-purple-500 bg-purple-600/20 text-white shadow-md shadow-purple-500/10'
                          : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                      }`}
                    >
                      <TokenLogo token={token} size={20} />
                      <span className="font-medium">{token.symbol}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
