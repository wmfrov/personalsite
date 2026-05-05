import React from 'react';
import { SeedData } from '../lib/hash';

interface HeaderProps {
  seed: string;
  setSeed: (seed: string) => void;
  seedData: SeedData | null;
  onExport: () => void;
}

export function Header({ seed, setSeed, seedData, onExport }: HeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b-[3px] border-ink bg-cream sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="font-bold uppercase tracking-widest text-sm">SEED:</span>
          <span className="bg-ink text-cream px-2 py-1 text-xs font-bold font-mono">
            {seedData?.hash ? seedData.hash.substring(0, 6) + '...' : '......'}
          </span>
        </div>
        <input
          type="text"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="border-[3px] border-ink bg-cream px-3 py-1 text-sm font-mono focus:outline-none w-48 shadow-[4px_4px_0_0_#000] focus:bg-ph-yellow transition-colors duration-0"
          style={{ borderRadius: 0 }}
          placeholder="ENTER SEED"
        />
      </div>
      
      <button 
        onClick={onExport}
        className="brutalist-button"
      >
        EXPORT BANNER
      </button>
    </div>
  );
}
