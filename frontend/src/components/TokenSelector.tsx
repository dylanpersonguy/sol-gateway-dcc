import React, { useState, useRef, useEffect } from 'react';
import {
  BRIDGE_TOKENS,
  CATEGORY_LABELS,
  type BridgeToken,
} from '../config/tokens';

interface TokenSelectorProps {
  selected: BridgeToken;
  onChange: (token: BridgeToken) => void;
  /** Show wrapped symbols (DCC side) instead of base symbols */
  showWrapped?: boolean;
}

export function TokenSelector({
  selected,
  onChange,
  showWrapped = false,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const displaySymbol = showWrapped ? selected.wrappedSymbol : selected.symbol;

  // Group tokens by category, filtered by search
  const filtered = BRIDGE_TOKENS.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.symbol.toLowerCase().includes(q) ||
      t.wrappedSymbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, BridgeToken[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  // Preserve category order
  const categoryOrder: BridgeToken['category'][] = [
    'native',
    'stablecoin',
    'btc',
    'eth',
    'ecosystem',
    'meme',
  ];

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl px-3 py-2.5 transition-colors min-w-[140px]"
      >
        <TokenLogo token={selected} size={24} />
        <span className="font-semibold text-white text-sm">{displaySymbol}</span>
        <ChevronDown className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-800">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search tokens..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Token list */}
          <div className="max-h-80 overflow-y-auto py-1 scrollbar-thin">
            {categoryOrder.map((cat) => {
              const tokens = grouped[cat];
              if (!tokens || tokens.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {CATEGORY_LABELS[cat]}
                  </div>
                  {tokens.map((token) => {
                    const isSelected = token.splMint === selected.splMint;
                    const sym = showWrapped ? token.wrappedSymbol : token.symbol;
                    return (
                      <button
                        key={token.splMint}
                        type="button"
                        onClick={() => {
                          onChange(token);
                          setOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-purple-600/20 text-white'
                            : 'hover:bg-gray-800 text-gray-300'
                        }`}
                      >
                        <TokenLogo token={token} size={28} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{sym}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {token.name}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-purple-400 text-xs">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-500 text-sm">
                No tokens found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Token Logo ── */

export function TokenLogo({
  token,
  size = 24,
}: {
  token: BridgeToken;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !token.logoURI) {
    return (
      <div
        className="rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300 flex-shrink-0"
        style={{ width: size, height: size }}
      >
        {token.symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={token.logoURI}
      alt={token.symbol}
      width={size}
      height={size}
      className="rounded-full flex-shrink-0 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/* ── Chevron icon ── */

function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
