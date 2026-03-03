import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { usePhantom } from '../context/PhantomContext';
import { useBridgeStore } from '../hooks/useBridgeStore';
import { bridgeApi } from '../services/api';
import { TokenSelector, TokenLogo } from './TokenSelector';
import toast from 'react-hot-toast';

export function DepositForm() {
  const { publicKey: adapterPubkey, signTransaction: adapterSign } = useWallet();
  const { getPublicKey, getSignTransaction } = usePhantom();
  const publicKey = getPublicKey(adapterPubkey);
  const signTransaction = getSignTransaction(adapterSign ?? null);
  const { connection } = useConnection();
  const { setActiveTransfer, selectedToken, setSelectedToken } = useBridgeStore();

  const [amount, setAmount] = useState('');
  const [recipientDcc, setRecipientDcc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isNativeSOL = selectedToken.splMint === 'So11111111111111111111111111111111111111112';

  const handleDeposit = async () => {
    if (!publicKey || !signTransaction) {
      toast.error('Wallet not connected');
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Invalid amount');
      return;
    }

    if (!recipientDcc || recipientDcc.length < 20) {
      toast.error('Invalid DCC recipient address');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await bridgeApi.createDeposit({
        sender: publicKey.toBase58(),
        recipientDcc,
        amount: amountNum,
        splMint: selectedToken.splMint,
      });

      if (!response.success) {
        throw new Error('Failed to create deposit instruction');
      }

      toast.success(`${selectedToken.symbol} deposit instruction generated — sign in wallet`);

      setActiveTransfer({
        transferId: 'pending',
        status: 'pending_confirmation',
        direction: 'sol_to_dcc',
        amount: amountNum.toString(),
        sender: publicKey.toBase58(),
        recipient: recipientDcc,
        splMint: selectedToken.splMint,
        tokenSymbol: selectedToken.symbol,
      });
    } catch (err: any) {
      toast.error(err.message || 'Deposit failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Deposit {selectedToken.symbol}</h2>
        <p className="text-gray-400 text-sm">
          Lock {selectedToken.symbol} on Solana to receive {selectedToken.wrappedSymbol}.DCC on DecentralChain
        </p>
      </div>

      {/* Token + Amount Input */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Token &amp; Amount
        </label>
        <div className="flex gap-2">
          <TokenSelector
            selected={selectedToken}
            onChange={setSelectedToken}
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
                         focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
              {selectedToken.symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Recipient Input */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          DCC Recipient Address
        </label>
        <input
          type="text"
          value={recipientDcc}
          onChange={(e) => setRecipientDcc(e.target.value)}
          placeholder="3P..."
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3
                     focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
        />
      </div>

      {/* Fee Estimate */}
      <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">You deposit</span>
          <span className="flex items-center gap-1.5">
            <TokenLogo token={selectedToken} size={16} />
            {amount || '0'} {selectedToken.symbol}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">You receive</span>
          <span>{amount || '0'} {selectedToken.wrappedSymbol}.DCC</span>
        </div>
        {selectedToken.solDecimals !== selectedToken.dccDecimals && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Decimal conversion</span>
            <span className="text-yellow-400 text-xs">
              {selectedToken.solDecimals}→{selectedToken.dccDecimals} dec
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Bridge fee</span>
          <span className="text-green-400">Free</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Network fee</span>
          <span>~0.000005 SOL</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Estimated time</span>
          <span>2-5 minutes</span>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleDeposit}
        disabled={isSubmitting || !amount || !recipientDcc}
        className="btn-primary w-full text-lg"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </span>
        ) : (
          `Deposit ${selectedToken.symbol}`
        )}
      </button>
    </div>
  );
}
