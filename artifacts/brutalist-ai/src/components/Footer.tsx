import React, { useEffect, useState } from 'react';
import { SeedData } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { PalettePicker } from './PalettePicker';

interface FooterProps {
  seed: string;
  setSeed: (seed: string) => void;
  seedData: SeedData | null;
  palette: Palette;
  setPalette: (id: string) => void;
}

export function Footer({ seed, setSeed, seedData, palette, setPalette }: FooterProps) {
  const [draft, setDraft] = useState(seed);

  useEffect(() => {
    setDraft(seed);
  }, [seed]);

  const commit = () => {
    if (draft !== seed) setSeed(draft);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-3 py-2 flex-wrap"
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        borderTop: '3px solid var(--ink)',
      }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-bold uppercase tracking-widest text-xs">SEED:</span>
        <span
          className="px-2 py-1 text-xs font-bold font-mono"
          style={{ background: 'var(--ink)', color: 'var(--bg)' }}
        >
          {seedData?.hash ? seedData.hash.substring(0, 6) + '...' : '......'}
        </span>
      </div>

      <PalettePicker palette={palette} setPalette={setPalette} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
        className="flex items-center gap-2 flex-1 min-w-[180px]"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="px-3 py-1 text-sm font-mono focus:outline-none flex-1 min-w-0"
          style={{
            border: '3px solid var(--ink)',
            background: 'var(--bg)',
            color: 'var(--ink)',
            boxShadow: 'var(--shadow-brutal)',
          }}
          placeholder="ENTER SEED"
          aria-label="Seed input — press Enter to regenerate"
        />
        <span className="hidden sm:inline text-[10px] uppercase tracking-widest font-bold select-none opacity-60">
          ↵ ENTER
        </span>
      </form>
    </div>
  );
}
