import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePhantom } from '../context/PhantomContext';
import { useBridgeStore } from '../hooks/useBridgeStore';
import { bridgeApi } from '../services/api';
import { TokenSelector, TokenLogo } from './TokenSelector';
import toast from 'react-hot-toast';

export function RedeemForm() {
  const { publicKey: adapterPubkey } = useWallet();
  const { getPublicKey } = usePhantom();
  const publicKey = getPublicKey(adapterPubkey);
  const { setActiveTransfer, selectedToken, setSelectedToken } = useBridgeStore();

  const [amount, setAmount] = useState('');
  const [dccSender, setDccSender] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRedeem = async () => {
    if (!publicKey) {
      toast.error('Connect Solana wallet to receive ' + selectedToken.symbol);
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Invalid amount');
      return;
    }

    if (!dccSender || dccSender.length < 20) {
      toast.error('Invalid DCC sender address');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await bridgeApi.createRedeem({
        sender: dccSender,
        solRecipient: publicKey.toBase58(),
        amount: amountNum,
        splMint: selectedToken.splMint,
      });

      if (!response.success) {
        throw new Error('Failed to create redeem instruction');
      }

      toast.success(`${selectedToken.wrappedSymbol}.DCC burn instruction generated — sign in DCC wallet`);

      setActiveTransfer({
        transferId: 'pending',
        status: 'pending_confirmation',
        direction: 'dcc_to_sol',
        amount: amountNum.toString(),
        sender: dccSender,
        recipient: publicKey.toBase58(),
        splMint: selectedToken.splMint,
        tokenSymbol: selectedToken.symbol,
      });
    } catch (err: any) {
      toast.error(err.message || 'Redeem failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Redeem {selectedToken.wrappedSymbol}.DCC</h2>
        <p className="text-gray-400 text-sm">
          Burn {selectedToken.wrappedSymbol}.DCC on DecentralChain to unlock {selectedToken.symbol} on Solana
        </p>
      </div>

      {/* DCC Sender */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Your DCC Address
        </label>
        <input
          type="text"
          value={dccSender}
          onChange={(e) => setDccSender(e.target.value)}
          placeholder="3P..."
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3
                     focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {/* Token + Amount */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Token &amp; Amount
        </label>
        <div className="flex gap-2">
          <TokenSelector
            selected={selectedToken}
            onChange={setSelectedToken}
            showWrapped
          />
          <div className="relative flex-1">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0.001"
              step="0.001"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-lg
                         focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
              {selectedToken.wrappedSymbol}
            </span>
          </div>
        </div>
      </div>

      {/* SOL Recipient */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          {selectedToken.symbol} Recipient (your connected wallet)
        </label>
        <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-gray-400 text-sm font-mono">
          {publicKey?.toBase58() || 'Connect wallet...'}
        </div>
      </div>

      {/* Fee Estimate */}
      <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">You burn</span>
          <span>{amount || '0'} {selectedToken.wrappedSymbol}.DCC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">You receive</span>
          <span className="flex items-center gap-1.5">
            <TokenLogo token={selectedToken} size={16} />
            {amount || '0'} {selectedToken.symbol}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Estimated time</span>
          <span>3-10 minutes</span>
        </div>
      </div>

      <button
        onClick={handleRedeem}
        disabled={isSubmitting || !amount || !dccSender}
        className="btn-primary w-full text-lg !bg-gradient-to-r !from-teal-600 !to-blue-600"
      >
        {isSubmitting ? 'Processing...' : `Burn & Redeem ${selectedToken.symbol}`}
      </button>
    </div>
  );
}
