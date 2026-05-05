import React, { useEffect, useState } from 'react';
import { SeedData } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { PalettePicker } from './PalettePicker';

interface HeaderProps {
  seed: string;
  setSeed: (seed: string) => void;
  seedData: SeedData | null;
  palette: Palette;
  setPalette: (id: string) => void;
  onExport: () => void;
}

export function Header({ seed, setSeed, seedData, palette, setPalette, onExport }: HeaderProps) {
  // Local draft so typing doesn't rehash on every keystroke; commit on Enter / blur.
  const [draft, setDraft] = useState(seed);

  useEffect(() => {
    setDraft(seed);
  }, [seed]);

  const commit = () => {
    if (draft !== seed) setSeed(draft);
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-2 sticky top-0 z-50"
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        borderBottom: '3px solid var(--ink)',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-bold uppercase tracking-widest text-sm">SEED:</span>
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
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="px-3 py-1 text-sm font-mono focus:outline-none w-48"
            style={{
              border: '3px solid var(--ink)',
              background: 'var(--bg)',
              color: 'var(--ink)',
              boxShadow: 'var(--shadow-brutal)',
            }}
            placeholder="ENTER SEED"
            aria-label="Seed input — press Enter to regenerate"
          />
          <span className="text-[10px] uppercase tracking-widest font-bold select-none opacity-60">
            ↵ ENTER
          </span>
        </form>
      </div>

      <button onClick={onExport} className="brutalist-button">
        EXPORT BANNER
      </button>
    </div>
  );
}
